import type { TFunction } from "i18next";

/** The CEFR buckets the server's placement scale can return (Govori.Contracts/CefrScale.cs). */
const KNOWN_LEVELS: readonly string[] = ["A1", "A2", "B1", "B2", "C1"];

/**
 * The human caption for a CEFR level, in the UI's language ("A2" → "boshlang'ich" /
 * "элементарный" / "elementary").
 *
 * The server sends `label_uz` alongside the level, and the result screen used to print it as-is —
 * so a student using the Russian or English UI got the one Uzbek phrase on an otherwise translated
 * screen. The caption is keyed by LEVEL here instead, because the level is the fact and the label
 * is presentation. `label_uz` stays in the API (it is part of the contract) and is only the
 * fallback for a level this table does not know — a new bucket added server-side then still shows
 * something sensible rather than a raw i18n key.
 */
export function cefrLabel(t: TFunction, level: string, fallback: string): string {
  return KNOWN_LEVELS.includes(level) ? t(`placement.levelLabel.${level}`) : fallback;
}
