import { useTranslation } from "react-i18next";
import { Button, Card, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import styles from "./GroupScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One ranked classmate row (a `/api/leaderboard?group_id=` entry). */
export interface GroupClassmate {
  id: string;
  rank: number;
  name: string;
  /** All-time XP — the ranking metric. */
  xp: number;
  currentStreak: number;
  /** The signed-in student's own row → highlighted. */
  isMe: boolean;
}

export interface GroupScreenProps {
  groupName: string;
  teacherName: string | null;
  memberCount: number;
  /** The group's students, already ranked (rank 1 first). */
  classmates: GroupClassmate[];
  /** Header back → returns to Home. */
  onBack: () => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * GroupScreen — the student's group view: who's in the group and how they rank
 * (the classmates leaderboard). Reached from the Home "O'QITUVCHINGIZ" block.
 * The board is the group-scoped `/api/leaderboard?group_id=`, which the server
 * only serves to members — so this doubles as the roster. Presentational +
 * prop-driven; the page fetches. Full-width; every colour / space / radius is a
 * token; the caller's own row is marked by rank + a "Siz" chip, never colour
 * alone.
 */
export function GroupScreen({
  groupName,
  teacherName,
  memberCount,
  classmates,
  onBack,
  activeNavKey = "home",
  onNavigate,
}: GroupScreenProps) {
  const { t } = useTranslation();

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: studentNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label={t("common.back")}
          className={styles.back}
        >
          <BackGlyph />
        </Button>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        <header className={styles.hero}>
          <Text as="h1" variant="title-l" className={styles.name}>
            {groupName}
          </Text>
          <Text as="p" variant="body-s" color="muted" className={styles.meta}>
            {t("groupBoard.meta", {
              teacher: teacherName ?? t("home.teacherRole"),
              count: memberCount,
            })}
          </Text>
        </header>

        <Text as="h2" variant="label" color="muted" className={styles.sectionLabel}>
          {t("groupBoard.classmates")}
        </Text>

        {classmates.length === 0 ? (
          <Text as="p" variant="body-s" color="muted">
            {t("groupBoard.empty")}
          </Text>
        ) : (
          <ul className={styles.list}>
            {classmates.map((c) => (
              <li key={c.id}>
                <Card
                  variant="panel"
                  padding="md"
                  className={cx(styles.row, c.isMe && styles.rowMe)}
                >
                  <span
                    className={cx(styles.rank, c.rank <= 3 && styles.rankTop)}
                    aria-hidden
                  >
                    {c.rank}
                  </span>

                  <span className={styles.who}>
                    <span className={styles.nameRow}>
                      <Text as="span" variant="title-s" truncate className={styles.whoName}>
                        {c.name}
                      </Text>
                      {c.isMe && <span className={styles.youBadge}>{t("groupBoard.you")}</span>}
                    </span>
                    <Text as="span" variant="body-s" color="muted">
                      {t("groupBoard.streak", { count: c.currentStreak })}
                    </Text>
                  </span>

                  <span className={styles.xp}>
                    <Text as="span" variant="title-s" numeric>
                      {c.xp}
                    </Text>
                    <Text as="span" variant="body-s" color="muted">
                      {t("groupBoard.xp")}
                    </Text>
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

const DEMO: GroupClassmate[] = [
  { id: "1", rank: 1, name: "Дилноза Юсупова", xp: 1240, currentStreak: 12, isMe: false },
  { id: "2", rank: 2, name: "Talaba Demo", xp: 980, currentStreak: 5, isMe: true },
  { id: "3", rank: 3, name: "Шерзод Рашидов", xp: 870, currentStreak: 3, isMe: false },
  { id: "4", rank: 4, name: "Нодира Тошева", xp: 610, currentStreak: 0, isMe: false },
];

/** GroupScreenDemo — standalone preview wired to a small mock roster. */
export default function GroupScreenDemo() {
  return (
    <GroupScreen
      groupName="Группа Ойбек"
      teacherName="Ойбек Каримов"
      memberCount={DEMO.length}
      classmates={DEMO}
      onBack={() => undefined}
      onNavigate={() => undefined}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Glyph                                                                       */
/* -------------------------------------------------------------------------- */

function BackGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
