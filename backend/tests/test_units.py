"""Unit tests for pure logic — no DB, no external services.

Run inside Docker:  docker compose run --rm backend pytest -q
"""

import json

import pytest

from app.core.breaker import CircuitBreaker, CircuitOpenError
from app.services.gamification import xp_for_band
from app.services.stt import _aggregate_scores, _parse_segment, _reference_match


# ─── XP rules ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "score,expected",
    [(None, 10), (0, 10), (50.0, 19), (100.0, 28), (67.0, 22), (90.0, 26)],
)
def test_xp_for_band(score, expected):
    assert xp_for_band(score) == expected


# ─── Azure STT parsing ──────────────────────────────────────────────────────
def _segment_json(text="привет мир", acc=80.0, n_words=2):
    return json.dumps(
        {
            "DisplayText": text,
            "NBest": [
                {
                    "Display": text,
                    "PronunciationAssessment": {
                        "AccuracyScore": acc,
                        "FluencyScore": 70.0,
                        "CompletenessScore": 100.0,
                        "PronScore": 75.0,
                    },
                    "Words": [
                        {
                            "Word": w,
                            "Offset": i * 10_000_000,
                            "Duration": 5_000_000,
                            "PronunciationAssessment": {
                                "AccuracyScore": acc,
                                "ErrorType": "None",
                            },
                        }
                        for i, w in enumerate(text.split()[:n_words])
                    ],
                }
            ],
        }
    )


def test_parse_segment_extracts_text_words_scores():
    seg = _parse_segment(_segment_json())
    assert seg["text"] == "привет мир"
    assert seg["n_words"] == 2
    assert seg["scores"]["accuracy"] == 80.0
    assert seg["scores"]["prosody"] is None  # absent → None, not crash
    w = seg["words"][0]
    assert w["start"] == 0.0 and w["end"] == 0.5 and w["accuracy"] == 80.0


def test_parse_segment_extracts_phonemes():
    raw = json.dumps(
        {
            "DisplayText": "мир",
            "NBest": [
                {
                    "Display": "мир",
                    "PronunciationAssessment": {"AccuracyScore": 80.0, "PronScore": 80.0},
                    "Words": [
                        {
                            "Word": "мир",
                            "Offset": 0,
                            "Duration": 5_000_000,
                            "PronunciationAssessment": {"AccuracyScore": 80.0},
                            "Phonemes": [
                                {"Phoneme": "m", "PronunciationAssessment": {"AccuracyScore": 95.0}},
                                {"Phoneme": "i", "PronunciationAssessment": {"AccuracyScore": 40.0}},
                                {"Phoneme": "r", "PronunciationAssessment": {"AccuracyScore": 88.0}},
                            ],
                        }
                    ],
                }
            ],
        }
    )
    seg = _parse_segment(raw)
    phs = seg["words"][0]["phonemes"]
    assert [p["phoneme"] for p in phs] == ["m", "i", "r"]
    assert phs[1]["accuracy"] == 40.0


def test_parse_segment_phonemes_none_when_absent():
    # Word granularity / Whisper-style data has no Phonemes key.
    seg = _parse_segment(_segment_json())
    assert seg["words"][0]["phonemes"] is None


def test_parse_segment_handles_garbage():
    assert _parse_segment("not json") is None
    assert _parse_segment(json.dumps({"NBest": []})) is None


def test_aggregate_scores_weights_by_word_count():
    a = _parse_segment(_segment_json(text="а б в г д е ж з и к", acc=100.0, n_words=10))
    b = _parse_segment(_segment_json(text="плохо тут", acc=50.0, n_words=2))
    agg = _aggregate_scores([a, b])
    # (100*10 + 50*2) / 12 = 91.7 — the long segment dominates
    assert agg["accuracy"] == 91.7


# ─── Shadowing content match (off-topic detection) ──────────────────────────
def test_reference_match_none_without_reference():
    assert _reference_match("привет мир", "") is None
    assert _reference_match("привет мир", "   ") is None


def test_reference_match_exact_repetition_is_on_topic():
    m = _reference_match("Привет, мир!", "привет мир")
    assert m["completeness"] == 100.0
    assert m["on_topic"] is True


def test_reference_match_off_topic_fails_gate():
    # Learner said something entirely different from the target sentence.
    m = _reference_match("сегодня хорошая погода на улице", "я люблю читать книги")
    assert m["completeness"] < 50.0
    assert m["on_topic"] is False


def test_reference_match_partial_repetition():
    # Said roughly half of the target words → counts as on-topic.
    m = _reference_match("я люблю читать", "я люблю читать книги каждый день")
    assert 0 < m["completeness"] <= 100.0
    assert m["matched_words"] == 3
    assert m["reference_words"] == 6


# ─── Circuit breaker ─────────────────────────────────────────────────────────
def test_breaker_opens_after_threshold_and_recovers():
    br = CircuitBreaker("test", threshold=2, cooldown=0.01)
    calls = {"n": 0}

    @br
    def flaky(fail: bool):
        calls["n"] += 1
        if fail:
            raise ValueError("boom")
        return "ok"

    for _ in range(2):
        with pytest.raises(ValueError):
            flaky(True)
    # circuit now open → fails fast without calling the function
    with pytest.raises(CircuitOpenError):
        flaky(False)
    assert calls["n"] == 2

    import time

    time.sleep(0.02)  # cooldown elapses → probe allowed, success closes circuit
    assert flaky(False) == "ok"
    assert flaky(False) == "ok"
