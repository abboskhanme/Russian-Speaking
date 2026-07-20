/**
 * AuthNote — the small tinted reassurance/info strip from the mockup: a leading
 * icon + a line of text on a success or primary tint (frames A1 login/register).
 * Tokens only — `success` uses `--success-tint`, `info` uses `--primary-tint`.
 */
import type { ReactNode } from "react";
import { cx } from "../../shared/ui";
import { CheckIcon, InfoIcon } from "./icons";
import styles from "./Auth.module.css";

export interface AuthNoteProps {
  tone: "success" | "info";
  children: ReactNode;
}

export function AuthNote({ tone, children }: AuthNoteProps) {
  const Icon = tone === "success" ? CheckIcon : InfoIcon;
  return (
    <div className={cx(styles.note, styles[`note-${tone}`])}>
      <span className={styles.noteIcon} aria-hidden>
        <Icon />
      </span>
      <span className={styles.noteText}>{children}</span>
    </div>
  );
}
