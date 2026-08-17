# Grader golden set — Faza 1.4–1.6

**What this is.** A frozen corpus of Russian learner answers with the behaviour the grader must
show on each. It turns *"the new grader is as good as the old one"* from a claim into a
measurement, and it is what stands between an AI change and a silent quality regression nobody
notices for a month.

**Why it exists now.** `docs/08` orders it before touching the AI. That order was right and it
slipped: the provider chain (Faza 3.4) landed first. This closes the gap — the chain is new, the
rubric was ported verbatim from the pre-rewrite Python grader, and this set is the instrument that
says whether the port changed anything.

---

## What is here, and what is honestly missing

| | Status |
|---|---|
| Grader corpus: transcript → expected behaviour | ✅ `cases.json`, 18 cases |
| Runner against the **real** provider chain | ✅ `Govori.UnitTests/Ai/GraderGoldenSetTests.cs` |
| CI gate: < 90% blocks the PR | ✅ `.github/workflows/ci.yml`, `golden` job |
| **40 recorded student clips for the STT half** | ⬜ **not here — see below** |

`docs/08 §1.4` asks for *"40 klip"* — forty recorded clips. This set covers the **grader**, which
takes a transcript, so it needs no audio and is complete on its own terms. What it does **not**
cover is the STT half: whether Azure hears a real learner correctly, at real recording quality,
with a real accent.

That gap is left open deliberately rather than filled with synthesised audio. A TTS voice reading
correct Russian is not a learner: it has none of the mispronunciations, hesitations, room noise, or
phone-microphone artefacts that STT actually has to survive, so a green run against it would be
evidence of nothing while looking like coverage. **Forty real clips have to come from real
students** — the one input a machine cannot manufacture.

The cases below are authored to specification rather than captured from users, and that is stated
plainly. The dev database holds only seeded demo rows (128 transcripts, all the same sentence), so
there was nothing real to draw from. Each case encodes a specific, checkable learner error — this
is a *specification* of grader behaviour, not a sample of traffic.

---

## How a case is judged

Three kinds of assertion, in increasing order of how much they are worth:

1. **Band range** (`overall_min` / `overall_max`) — deliberately wide. Model judgement moves;
   a tight band would flap on every model update and train everyone to ignore the run. These catch
   gross breakage: a grader returning 0 or 100 for everything.

2. **Behaviour** — did it find the error that is actually there (`must_find_correction_types`), is
   the feedback in Uzbek, did it avoid inventing corrections on already-correct text
   (`max_corrections`)? These catch a grader that produces plausible numbers and useless feedback.

3. **Ordering** (`ordering` in `cases.json`) — *the strongest check here.* A clearly better answer
   must score clearly higher than a worse one, by at least the stated margin. Ordering survives
   model drift, recalibration, and prompt changes: whatever the absolute numbers do, B2 fluent must
   outrank A1 broken. If ordering breaks, the grader is broken — no interpretation needed.

The C6 rule — a "correction" differing only by punctuation, casing, or whitespace is not a
correction — is checked on **every** case, not per case, because it is a property of the grader
rather than of any one answer.

**Pass threshold: 90%** of all assertions across all cases. Not 100%: a real LLM grader is
stochastic, and a gate that demands perfection gets disabled the first week. Not lower: at 80% a
grader could fail one case in five and still ship.

### Observed baseline

First two runs against the chain as configured today (Claude has no key, so Gemini serves):

| run | score | assertions that missed |
|---|---|---|
| 1 | 97/99 — **98.0%** | `a2_aspect_error` overall 81 > 78; `code_switch` overall 84 > 75 |
| 2 | 98/99 — **99.0%** | `a2_word_order` overall 84 > 80 |

**All 8 ordering checks passed both times**, with enormous headroom — relevance on the off-topic
case came out 90 points below the on-topic one, and 100 below on the echo case.

The two bands that missed in run 1 were widened, with the reason recorded on the case itself: in
both, the grader had *found* the error and priced it, and the cap was an authoring estimate being
tight rather than the grader being wrong. The run-2 miss was **left alone on purpose**. A different
single band drifting past its edge on each run is exactly the stochasticity the 90% threshold
exists to absorb; widening every band that ever flaps converges on a set that asserts nothing. The
ordering checks are the part that is meant to be immovable, and they are.


---

## Running it

Nothing is installed on the host; everything runs in Docker.

```sh
# Real vendor calls — needs keys. From the repo root:
docker run --rm --env-file .env -e GOVORI_GOLDEN=1 \
  -v "$PWD":/repo -v govori-nuget:/root/.nuget/packages -w /repo/backend-dotnet \
  mcr.microsoft.com/dotnet/sdk:9.0 \
  dotnet vstest tests/Govori.UnitTests/bin/Release/net9.0/Govori.UnitTests.dll \
    --TestCaseFilter:"FullyQualifiedName~GraderGoldenSet" \
    --logger:"console;verbosity=detailed"
```

Without `GOVORI_GOLDEN=1` the test reports itself **skipped**, with the reason. It is never
silently green: a run that did nothing must not be readable as evidence that the grader is fine.

## Changing the set

Adding cases is normal. **Loosening a band or deleting a case to make a red run go green is not** —
that is deleting the instrument because you did not like the reading. If a case is genuinely wrong,
say why in the commit message.
