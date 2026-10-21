import { useTranslation } from "react-i18next";
import { Button, Card, Mascot, Text } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import styles from "./PracticeScreen.module.css";

export interface PracticeStateScreenProps {
  title: string;
  body: string;
  /** The one way on (back to Mashq / Home). */
  actionLabel: string;
  onAction: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/**
 * PracticeStateScreen — the task route's "nothing to answer here" states. The
 * recorder itself is full-viewport (no frame); these states are not, so the page
 * renders them inside the student layout and the nav stays reachable:
 *
 *   • UNAVAILABLE — the link named a task this student cannot see (unpublished,
 *     deleted, or outside their catalogue). It used to be quietly swapped for the
 *     first open task, so the student answered a question they had not been set.
 *   • EMPTY — no task is open at all.
 *
 * Deliberately not the generic load-error card: nothing failed to load, and a
 * "try again" button would promise a different outcome that a retry cannot give.
 */
export function PracticeStateScreen({
  title,
  body,
  actionLabel,
  onAction,
}: PracticeStateScreenProps) {
  const { t } = useTranslation();
  return (
    <Page title={t("nav.practice")}>
      <div className={styles.page}>
        <Card variant="tint" padding="lg" className={styles.outcome} role="status">
          <Mascot mood="sleepy" size={104} label="" />
          <Text as="h2" variant="title-s" align="center">
            {title}
          </Text>
          <Text as="p" variant="body" color="ink-soft" align="center">
            {body}
          </Text>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}
