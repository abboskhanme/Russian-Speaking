import type { TFunction } from "i18next";

/** The CEFR buckets the server's scale can return (Govori.Contracts/CefrScale.cs). */
const KNOWN_LEVELS: readonly string[] = ["A1", "A2", "B1", "B2", "C1"];

/**
 * The human caption for a CEFR level, in the UI's language ("A2" → "boshlang'ich" /
 * "элементарный" / "elementary").
 *
 * Every API that reports a level also sends a caption — `label_uz` (placement), `level_label`
 * (me / profile / progress), `class_level_label` (teacher analytics) — and all of them are Uzbek
 * whatever the student reads the app in (CefrScale has one label per level). Printed raw, that was
 * the one untranslated phrase on the Russian and English screens. So the caption is keyed by LEVEL
 * here, because the level is the fact and the label is presentation; and it is resolved at RENDER
 * time, so switching the language re-captions what is already on screen.
 *
 * The server's caption stays in the contract and is the fallback for a level this table does not
 * know — a bucket added server-side then still shows something sensible instead of a raw i18n key.
 * No level means no caption (the screens hide the badge), whatever the server sent.
 */
export function cefrLabel(t: TFunction, level: string, fallback: string): string;
export function cefrLabel(
  t: TFunction,
  level: string | null | undefined,
  fallback: string | null | undefined,
): string | null;
export function cefrLabel(
  t: TFunction,
  level: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (!level) return null;
  return KNOWN_LEVELS.includes(level) ? t(`cefr.label.${level}`) : (fallback ?? null);
}
