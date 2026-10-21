import type { TFunction } from "i18next";

/**
 * The note under a curated model suggestion, in the interface language.
 *
 * The server's curated model lists (`AppSettingsService.Known*Models`) carry a
 * one-line note written in whatever language that list was typed in — the
 * Gemini notes in English, the rest in Uzbek — so the Uzbek admin screen showed
 * "Fast and cheap; ~500 requests/day…" (UI audit, 44-). The notes are looked up
 * here by model id under `admin.modelNotes.*`; an id the client does not know
 * (a model added server-side later) shows the server's note as sent.
 *
 * i18next splits keys on ".", and model ids contain dots ("gemini-2.5-flash"),
 * so the id is slugged with "_" before the lookup.
 */
export function modelNote(id: string, note: string, t: TFunction): string {
  const key = `admin.modelNotes.${id.replace(/\./g, "_")}`;
  return t(key, { defaultValue: note });
}
