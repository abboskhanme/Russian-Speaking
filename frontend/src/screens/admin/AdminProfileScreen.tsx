import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Tabs, Text } from "../../shared/ui";
import type { TabItem } from "../../shared/ui";
import { Page } from "../../widgets";
import type { NavItem } from "../../widgets";
import { IdentityCard, InfoTab, SettingsTab, mockLinks, mockProfileUser } from "../profile";
import type {
  EditableInfo,
  InfoTabProps,
  ProfileUser,
  SettingsLanguage,
  SettingsTheme,
} from "../profile";
import styles from "./AdminProfileScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export type AdminProfileTabKey = "info" | "settings";

export interface AdminProfileProps {
  user: ProfileUser;
  language: SettingsLanguage;
  theme: SettingsTheme;
  notifications: boolean;
  /** From GET /api/settings/links — powers the help modal. Null while unloaded. */
  links: { tgSupportUrl: string; tgChannelUrl: string } | null;
  activeTab?: AdminProfileTabKey;
  onChangeTab?: (key: AdminProfileTabKey) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onBack?: () => void;
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
 * AdminProfileScreen (`/admin/profile`) — the admin's own account, reached from the
 * header avatar. Until it existed an admin could not change their language, their
 * phone, or even sign out.
 *
 * Built exactly like the teacher's profile, and for the same reason: an account
 * header, identity rows with their two verified editing flows, and a settings list
 * are not a panel's WORK — they are the same account on every panel, so the parts
 * are REUSED from `screens/profile` (`IdentityCard`, `InfoTab`, `SettingsTab`) and
 * never restated. The admin's work screens stay entirely their own.
 *
 * The differences ride the props the teacher profile introduced: no CEFR row (not a
 * learner), no PRO upsell (no learner subscription to buy), and the "related" block
 * says what this account is instead of listing a group.
 */
export function AdminProfileScreen({
  user,
  language,
  theme,
  notifications,
  links,
  activeTab,
  onChangeTab,
  onBack,
  onSaveInfo,
  onRequestPhoneChange,
  onConfirmPhoneChange,
  onChangeAvatar,
  onRemoveAvatar,
  onChangeLanguage,
  onChangeTheme,
  onChangeNotifications,
  onLogout,
}: AdminProfileProps) {
  const { t } = useTranslation();
  const panelId = useId();

  // Controlled when the host passes both; otherwise the screen owns the choice.
  const [ownTab, setOwnTab] = useState<AdminProfileTabKey>("info");
  const current = activeTab ?? ownTab;
  const selectTab = (key: string) => {
    const next = key as AdminProfileTabKey;
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
    <Page title={t("nav.profile")}>
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
            {t("nav.profile")}
          </Text>
        </header>

        <IdentityCard user={user} onChangeAvatar={onChangeAvatar} onRemoveAvatar={onRemoveAvatar} />

        <Tabs items={items} activeKey={current} onChange={selectTab} aria-label={t("nav.profile")} />

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
              relatedBlock={<RoleBlock />}
              onSaveInfo={onSaveInfo}
              onRequestPhoneChange={onRequestPhoneChange}
              onConfirmPhoneChange={onConfirmPhoneChange}
            />
          ) : (
            <SettingsTab
              language={language}
              theme={theme}
              notifications={notifications}
              // An admin is never upsold a learner subscription — `hideUpgrade` drops
              // the card outright rather than claiming `isPremium`.
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
    </Page>
  );
}

/* -------------------------------------------------------------------------- */
/* Parts                                                                      */
/* -------------------------------------------------------------------------- */

/** HISOB TURI — where the student's group card and the teacher's GURUHLARIM sit.
 * An admin belongs to no group; what is worth saying here is what the account can
 * do, since that is what separates it from every other account on the platform. */
function RoleBlock() {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-label={t("admin.profile.roleTitle")}>
      <Text as="h2" variant="label" color="muted" className={styles.legend}>
        {t("admin.profile.roleTitle")}
      </Text>
      <Card variant="flat" padding="md">
        <Text as="p" variant="body" weight="semibold">
          {t("admin.role.names.admin")}
        </Text>
        <Text as="p" variant="body-s" color="muted">
          {t("admin.profile.roleBody")}
        </Text>
      </Card>
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

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo.                                        */
/* -------------------------------------------------------------------------- */

export default function AdminProfileDemo() {
  return (
    <AdminProfileScreen
      user={mockProfileUser}
      language="uz"
      theme="light"
      notifications
      links={mockLinks}
    />
  );
}
