import type { ReactNode } from "react";
import { Button } from "../Button";
import { Mascot } from "../Mascot";
import type { MascotMood } from "../Mascot";
import { Text } from "../Text";
import { cx } from "../utils/cx";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  /** The ONE primary action. Omit for a purely informative state. */
  actionLabel?: string;
  onAction?: () => void;
  /** Govo's mood — "idle" by default; "sleepy" suits "nothing here yet". */
  mood?: MascotMood;
  /** Smaller mascot + tighter padding, for use inside a card or tab. */
  compact?: boolean;
  className?: string;
}

/**
 * EmptyState — Govo + one sentence of what goes here + ONE primary action.
 * Replaces the "grey sentence in a white box": an empty place should say what
 * will fill it and offer the single step that fills it, never a dead end.
 */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  mood = "idle",
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.root, compact && styles.compact, className)} role="status">
      <Mascot mood={mood} size={compact ? 64 : 88} label="" />
      <Text as="p" variant={compact ? "title-s" : "title-m"} className={styles.title}>
        {title}
      </Text>
      {body && (
        <Text as="p" variant="body-s" color="muted" className={styles.body}>
          {body}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction} className={styles.action}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
