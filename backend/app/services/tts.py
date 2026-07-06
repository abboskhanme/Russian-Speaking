"""Text-to-speech for Russian via Azure AI Speech (same key/region as STT).

Used for the "hear the correct pronunciation" button — turns a word or phrase into
a small MP3 the browser can play. Runs synchronously (short texts, ~1–2 s)."""

import azure.cognitiveservices.speech as speechsdk

from app.services import app_settings as _cfg

# A clear Russian neural voice. Kept simple/fixed — this is a pronunciation model.
_VOICE = "ru-RU-SvetlanaNeural"
# Guard against abuse / runaway cost on the public guest endpoint.
MAX_TTS_CHARS = 300


def synthesize(text: str) -> bytes:
    """Synthesize `text` to 16 kHz mono MP3 bytes. Raises on failure/misconfig."""
    stt = _cfg.resolve_stt()
    key, region = stt.get("azure_speech_key"), stt.get("azure_speech_region")
    if not key or not region:
        raise RuntimeError("Azure Speech is not configured (no key/region) — TTS unavailable")

    cfg = speechsdk.SpeechConfig(subscription=key, region=region)
    cfg.speech_synthesis_voice_name = _VOICE
    cfg.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
    )
    # audio_config=None → don't play on a speaker; return the bytes in the result.
    synth = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=None)
    result = synth.speak_text_async(text[:MAX_TTS_CHARS]).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        return result.audio_data
    detail = ""
    if result.reason == speechsdk.ResultReason.Canceled:
        detail = f": {result.cancellation_details.reason} {result.cancellation_details.error_details}"
    raise RuntimeError(f"TTS failed ({result.reason}){detail}")
