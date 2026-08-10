import { useTranslation } from "react-i18next";
import { Button, Card, Text, cx } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, ThemeToggle, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { mockTeacherProfile } from "./profile.mock";
import { BackGlyph } from "./TeacherGroupDetailScreen";
import styles from "./TeacherProfileScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The three UI languages, named by their own endonyms. */
export type TeacherLanguage = "uz" | "ru" | "en";

export interface TeacherProfileIdentity {
  fullName: string;
  initials?: string;
  /** The real phone the account was created with; null on legacy rows. */
  phone?: string | null;
  /** "qo'shilgan iyul 2026" — already localized by the caller, since month names
   * cannot come from `Intl` here. Omit when the date is unparseable. */
  joined?: string;
}

/** One of the teacher's own groups, as the profile lists them. */
export interface TeacherProfileGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface TeacherProfileProps {
  identity: TeacherProfileIdentity;
  groups: TeacherProfileGroup[];
  language: TeacherLanguage;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  onChangeLanguage?: (lang: TeacherLanguage) => void;
  onOpenGroup?: (id: string) => void;
  onLogout?: () => void;
}

/** Endonyms — each language named in itself, never translated. A picker that
 * renders every option in the CURRENT language is unusable to someone who cannot
 * read it, which is the exact person reaching for it. */
const LANGUAGES: Array<{ value: TeacherLanguage; label: string }> = [
  { value: "uz", label: "O‘zbekcha" },
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" },
];

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherProfileScreen — **Phase 7**, reached from the A1 header avatar. The
 * teacher nav has no Profil item by design (the mockup's bottom bar is
 * `Bosh · Klasslar · Navbat · Kontent · Analitika`), so the avatar IS this
 * screen's entry point.
 *
 * **This is the one teacher screen with no mockup.** `Govorim - Teacher.dc.html`
 * has no profile board at all, so the layout is the teacher panel's own idiom —
 * identity card, the teacher's groups, settings, sign out — rather than the
 * student profile re-skinned. The shared CONTROLS (`ThemeToggle`) are reused
 * because they are infrastructure; the layout is not.
 *
 * **No notifications toggle.** There is no notification-preference column and no
 * endpoint behind one, so the switch would forget the teacher's choice on every
 * reload. A control that silently does nothing is worse than an absent one; it is
 * recorded as a follow-up in the plan instead.
 *
 * **No results / achievements block either** — those are a learner's numbers. A
 * teacher's own attempts are not what this screen is for.
 */
export function TeacherProfileScreen({
  identity,
  groups,
  language,
  activeNavKey = "home",
  onNavigate,
  queuedCount = 0,
  onBack,
  onChangeLanguage,
  onOpenGroup,
  onLogout,
}: TeacherProfileProps) {
  const { t } = useTranslation();
  const initials = identity.initials ?? deriveInitials(identity.fullName);
  const students = groups.reduce((sum, g) => sum + g.memberCount, 0);

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: teacherNavItems(t, queuedCount),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("teacher.profile.title")}
        </Text>
      }
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page} data-density="compact">
        <header className={styles.head}>
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
            aria-label={t("common.back")}
          >
            <BackGlyph />
          </button>
          <Text as="span" variant="title-l" className={styles.title} truncate>
            {t("teacher.profile.title")}
          </Text>
        </header>

        {/* ---- Identity ---- */}
        <Card variant="outline" padding="lg" className={styles.identity}>
          <span className={styles.avatar} aria-hidden>
            <Text as="span" variant="title-m" weight="bold">
              {initials}
            </Text>
          </span>
          <span className={styles.identityBody}>
            <Text as="p" variant="title-m" weight="bold" truncate>
              {identity.fullName}
            </Text>
            <Text as="p" variant="body-s" color="muted">
              {t("teacher.role")}
              {identity.joined ? ` · ${identity.joined}` : ""}
            </Text>
            {identity.phone && (
              <Text as="p" variant="body-s" color="muted" numeric>
                {identity.phone}
              </Text>
            )}
          </span>
        </Card>

        {/* ---- Guruhlarim ---- */}
        <section className={styles.section}>
          <Text as="h2" variant="label" color="faint" className={styles.legend}>
            {t("teacher.profile.groups")}
          </Text>

          {groups.length === 0 ? (
            <Card variant="flat" padding="md">
              <Text as="p" variant="body" color="muted">
                {t("teacher.profile.noGroups")}
              </Text>
            </Card>
          ) : (
            <>
              <ul className={styles.groupList}>
                {groups.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className={styles.groupRow}
                      onClick={() => onOpenGroup?.(g.id)}
                    >
                      <Text as="span" variant="body" weight="bold" className={styles.groupName} truncate>
                        {g.name}
                      </Text>
                      <Text as="span" variant="body-s" color="muted">
                        {t("teacher.members", { count: g.memberCount })}
                      </Text>
                      <ChevronGlyph />
                    </button>
                  </li>
                ))}
              </ul>
              {/* The reach line double-counts a student who is in two of this
                  teacher's groups — GroupResponse carries only a count, and
                  deduping would mean fetching every roster from a screen that
                  does not otherwise need them. */}
              <Text as="p" variant="body-s" color="faint">
                {t("teacher.profile.reach", { count: students })}
              </Text>
            </>
          )}
        </section>

        {/* ---- Sozlamalar ---- */}
        <section className={styles.section}>
          <Text as="h2" variant="label" color="faint" className={styles.legend}>
            {t("teacher.profile.settings")}
          </Text>

          <Card variant="outline" padding="md" className={styles.settingRow}>
            <Text as="span" variant="body" weight="semibold">
              {t("teacher.profile.language")}
            </Text>
            <div
              className={styles.langGroup}
              role="radiogroup"
              aria-label={t("teacher.profile.language")}
            >
              {LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  role="radio"
                  aria-checked={l.value === language}
                  className={cx(styles.lang, l.value === language && styles.langOn)}
                  onClick={() => onChangeLanguage?.(l.value)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Card>

          <Card variant="outline" padding="md" className={styles.settingRow}>
            <Text as="span" variant="body" weight="semibold">
              {t("teacher.profile.theme")}
            </Text>
            <ThemeToggle />
          </Card>
        </section>

        <div className={styles.footer}>
          <Button variant="ghost" size="lg" className={styles.logout} onClick={onLogout}>
            {t("profile.logout")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

function ChevronGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "Aziz Karimov" → "AK". Same rule the A1 header avatar uses. */
function deriveInitials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function TeacherProfileDemo() {
  return <TeacherProfileScreen {...mockTeacherProfile} />;
}
