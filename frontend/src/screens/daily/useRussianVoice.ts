/**
 * useRussianVoice — the browser's own Russian voice, or nothing at all.
 *
 * The warm-up is «Eshit va takrorla», and hearing the line first is half of it.
 * The server has a real TTS provider, but it bills per call and is deliberately
 * fenced to the auth-less guest demo; wiring the daily session to it would open a
 * new spending path for a step that exists to be free (docs/08 §6.3 — the session
 * must not create one). `speechSynthesis` is already in the browser, costs
 * nothing, and never leaves the device.
 *
 * It is also genuinely optional. Voice availability is a property of the
 * operating system, not of the page: a Linux Chromium with no speech packages
 * installed has none, and Android/iOS/macOS/Windows all differ. So this hook
 * reports whether a Russian voice EXISTS, and the screen shows a listen button
 * only when one does — rather than offering a button that would silently do
 * nothing, which is the failure mode people report as "the audio is broken".
 *
 * Voices load asynchronously in every engine (the first `getVoices()` is
 * routinely empty), which is why `voiceschanged` is subscribed to rather than
 * polled.
 */
import { useCallback, useEffect, useRef, useState } from "react";

function pickRussian(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  // `lang` is a BCP-47 tag ("ru-RU", occasionally just "ru"), so match the prefix
  // rather than an exact string. A local voice is preferred over a network one:
  // the remote ones stall on a slow connection, and a warm-up that waits is worse
  // than a warm-up that is read silently.
  const russian = voices.filter((v) => v.lang?.toLowerCase().startsWith("ru"));
  return russian.find((v) => v.localService) ?? russian[0] ?? null;
}

export interface RussianVoice {
  /** True once a Russian voice is known to exist. The UI hangs off this. */
  available: boolean;
  /** Speak one line. A no-op when no voice is available. */
  speak: (text: string) => void;
  /** Stop whatever is being spoken — called on unmount and on step changes, so a
   * phrase never keeps talking over the next screen. */
  cancel: () => void;
}

export function useRussianVoice(): RussianVoice {
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;

    const load = () => {
      const voice = pickRussian(synth.getVoices());
      voiceRef.current = voice;
      setAvailable(voice !== null);
    };

    load();                                   // often empty on the first call…
    synth.addEventListener("voiceschanged", load);   // …and filled by this event
    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel();
  }, []);

  const speak = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    const voice = voiceRef.current;
    if (!synth || !voice) return;
    // Cancel first: tapping a second phrase should replace the first, not queue
    // behind it. A queue here reads as lag.
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    // Slightly under natural pace. This is a shadowing model for a learner who is
    // about to repeat it, not a news reader.
    utterance.rate = 0.9;
    synth.speak(utterance);
  }, []);

  return { available, speak, cancel };
}
