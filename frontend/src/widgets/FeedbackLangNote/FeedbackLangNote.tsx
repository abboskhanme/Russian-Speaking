/**
 * FeedbackLangNote — one quiet line under an AI feedback card when the
 * feedback is written in a different language than the interface.
 *
 * Why: since S9 the grader writes in the STUDENT's interface language at
 * grading time (`feedback.lang`). Rows graded earlier, or graded while the
 * student used another language — and every row a teacher reads in their own
 * UI language — can therefore differ from the language on screen. Stored
 * feedback is never re-translated (it is the record of what the student was
 * told), so the screen says so instead of looking broken. See ASSUMPTIONS.md.
 */
import { useTranslation } from "react-i18next";
import { getLang } from "../../shared/i18n";
import styles from "./FeedbackLangNote.module.css";

export interface FeedbackLangNoteProps {
  /** `AiFeedback.lang` — undefined (plain-text legacy row) renders nothing. */
  lang?: "uz" | "ru" | "en";
  className?: string;
}

export function FeedbackLangNote({ lang, className }: FeedbackLangNoteProps) {
  // useTranslation re-renders this on a language switch, so getLang() is current.
  const { t } = useTranslation();
  if (!lang || lang === getLang()) return null;
  return (
    <p className={[styles.note, className].filter(Boolean).join(" ")}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" className={styles.icon}>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M1.75 8h12.5M8 1.75c1.9 2 1.9 10.5 0 12.5M8 1.75c-1.9 2-1.9 10.5 0 12.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span>{t(`feedbackLang.note.${lang}`)}</span>
    </p>
  );
}
