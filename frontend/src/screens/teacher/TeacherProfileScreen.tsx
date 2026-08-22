import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Tabs, Text } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, teacherNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { IdentityCard, InfoTab, SettingsTab } from "../profile";
import type {
  EditableInfo,
  InfoTabProps,
  ProfileUser,
  SettingsLanguage,
  SettingsTheme,
} from "../profile";
import { mockTeacherProfile } from "./profile.mock";
import styles from "./TeacherProfileScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export type TeacherProfileTabKey = "info" | "settings";

/** One of the teacher's own groups, as the profile lists them. */
export interface TeacherProfileGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface TeacherProfileProps {
  user: ProfileUser;
  groups: TeacherProfileGroup[];
  language: SettingsLanguage;
  theme: SettingsTheme;
  notifications: boolean;
  /** From GET /api/settings/links — powers the help modal. Null while unloaded. */
  links: { tgSupportUrl: string; tgChannelUrl: string } | null;
  activeTab?: TeacherProfileTabKey;
  onChangeTab?: (key: TeacherProfileTabKey) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  queuedCount?: number;
  onBack?: () => void;
  onOpenGroup?: (id: string) => void;
  /** Ma'lumot — persist the edited name + address. Omit and the tab is read-only. */
  onSaveInfo?: (values: EditableInfo) => Promise<void>;
  onRequestPhoneChange?: InfoTabProps["onRequestPhoneChange"];
  onConfirmPhoneChange?: InfoTabProps["onConfirmPhoneChange"];
  onChangeAvatar?: (file: File) => Promise<void>;
  onRemoveAvatar?: () => Promise<void>;
  onChangeLanguage?: (language: SettingsLanguage) => void;
  onChangeTheme?: (theme: SettingsTheme) => void;
  onChangeNotifications?: (on: boolean) => void;
  onLogout?: () => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * TeacherProfileScreen — **Phase 7**, reached from the A1 header avatar. The
 * teacher nav has no Profil item by design (its bar is
 * `Bosh · Klasslar · Navbat · Kontent · Analitika`), so the avatar IS the entry.
 *
 * **Deliberately the same shape as the student's Profil**, per the product call:
 * identity card → `Ma'lumot | Sozlamalar` → the same rows, the same editing
 * flows, the same settings list. It REUSES `IdentityCard`, `InfoTab` and
 * `SettingsTab` rather than restating them, because an account header, a set of
 * identity fields and a settings list are not student concepts — two copies
 * would drift the moment either gained a field.
 *
 * This narrows the panel's "never a student re-skin" rule to exactly where it
 * earns its keep: the teacher's WORK screens (Obzor · Klasslar · Navbat ·
 * Kontent · Analitika) remain entirely their own. Account management is not
 * teacher work.
 *
 * The three genuine differences ride as props: no CEFR row (a band is a
 * learner's number), the group block becomes GURUHLARIM (a student is in one
 * group, a teacher owns several), and no PRO upsell (a teacher has no learner
 * subscription to buy).
 *
 * There is no "Natijalar" tab: those are a learner's attempts, and a teacher's
 * own practice history is not what this screen is for.
 */
export function TeacherProfileScreen({
  user,
  groups,
  language,
  theme,
  notifications,
  links,
  activeTab,
  onChangeTab,
  activeNavKey = "home",
  onNavigate,
  queuedCount = 0,
  onBack,
  onOpenGroup,
  onSaveInfo,
  onRequestPhoneChange,
  onConfirmPhoneChange,
  onChangeAvatar,
  onRemoveAvatar,
  onChangeLanguage,
  onChangeTheme,
  onChangeNotifications,
  onLogout,
}: TeacherProfileProps) {
  const { t } = useTranslation();
  const panelId = useId();

  // Controlled when the host passes both; otherwise the screen owns the choice.
  const [ownTab, setOwnTab] = useState<TeacherProfileTabKey>("info");
  const current = activeTab ?? ownTab;
  const selectTab = (key: string) => {
    const next = key as TeacherProfileTabKey;
    if (onChangeTab) onChangeTab(next);
    else setOwnTab(next);
  };

  const items: TabItem[] = useMemo(
    () => [
      { key: "info", label: t("profile.tabs.info") },
      { key: "settings", label: t("profile.tabs.settings") },
    ],
    [t],
  );

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
      <div className={styles.page}>
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

        <IdentityCard user={user} onChangeAvatar={onChangeAvatar} onRemoveAvatar={onRemoveAvatar} />

        <Tabs
          items={items}
          activeKey={current}
          onChange={selectTab}
          aria-label={t("teacher.profile.title")}
        />

        <div id={panelId} role="tabpanel" tabIndex={-1} className={styles.panel}>
          {current === "info" ? (
            <InfoTab
              user={{
                name: user.name,
                phone: user.phone,
                region: user.region,
                district: user.district,
                level: null,
                levelLabel: null,
                registeredAt: user.registeredAt,
              }}
              // Unused: `relatedBlock` replaces the student's group section.
              group={null}
              showLevel={false}
              relatedBlock={<GroupsBlock groups={groups} onOpenGroup={onOpenGroup} />}
              onSaveInfo={onSaveInfo}
              onRequestPhoneChange={onRequestPhoneChange}
              onConfirmPhoneChange={onConfirmPhoneChange}
            />
          ) : (
            <SettingsTab
              language={language}
              theme={theme}
              notifications={notifications}
              // A teacher is never upsold a learner subscription, so `isPremium`
              // is not consulted at all — `hideUpgrade` drops the card outright.
              isPremium={false}
              hideUpgrade
              links={links}
              onChangeLanguage={onChangeLanguage}
              onChangeTheme={onChangeTheme}
              onChangeNotifications={onChangeNotifications}
              onLogout={onLogout}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/** GURUHLARIM — the teacher's counterpart to the student's "Guruh va o'qituvchi".
 * A student is IN one group and has a teacher; a teacher OWNS several groups and
 * has none, so this is a list that leads onward, not a single card. */
function GroupsBlock({
  groups,
  onOpenGroup,
}: {
  groups: TeacherProfileGroup[];
  onOpenGroup?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const students = groups.reduce((sum, g) => sum + g.memberCount, 0);

  return (
    <section className={styles.section} aria-label={t("teacher.profile.groups")}>
      <Text as="h2" variant="label" color="muted" className={styles.legend}>
        {t("teacher.profile.groups")}
      </Text>

      {groups.length === 0 ? (
        <Card variant="flat" padding="lg">
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
          {/* Double-counts a student who is in two of this teacher's groups —
              GroupResponse carries only a count, and deduping would mean fetching
              every roster from a screen that does not otherwise need them. */}
          <Text as="p" variant="body-s" color="muted">
            {t("teacher.profile.reach", { count: students })}
          </Text>
        </>
      )}
    </section>
  );
}

function BackGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function TeacherProfileDemo() {
  return <TeacherProfileScreen {...mockTeacherProfile} />;
}
