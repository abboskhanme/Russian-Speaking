import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Text, VisuallyHidden, cx } from "../../shared/ui";
import { AppShell, Brand, ThemeToggle, studentNavItems } from "../../widgets";
import type { NavItem, ThemeMode } from "../../widgets";
import {
  mockLanguage,
  mockPremium,
  mockProfileUser,
  mockSettings,
} from "./profile.mock";
import styles from "./ProfileScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

export interface ProfileUser {
  /** Display name (e.g. "Aziz Karimov"). */
  name: string;
  /** Account email — the muted identity line. */
  email: string;
  /** CEFR level badge (e.g. "A2"). Hidden when omitted. */
  level?: string;
  /** Human level caption (e.g. "boshlang'ich") shown beside the level. */
  levelLabel?: string;
  /** Avatar image URL. Falls back to initials derived from `name`. */
  avatarUrl?: string;
  /** Verified account — shows a success check beside the name. */
  verified?: boolean;
}

export interface ProfilePremium {
  /** Whether the student is on a paid plan. */
  active: boolean;
  /** Plan name shown when `active` (default "Premium"). */
  planLabel?: string;
  /**
   * Free-plan attempts remaining (freemium: 3 free attempts). Shown in the
   * free-plan caption when provided.
   */
  attemptsLeft?: number;
  /** Renewal / validity caption shown when `active` (e.g. "1-avgustgacha"). */
  renewsLabel?: string;
}

/** The three UI languages offered (docs/04 §4.7 — onboarding step 1). */
export type AppLanguage = "uz" | "ru" | "en";

/** Editable rows that route to a dedicated editor via `onEditSetting`. */
export type ProfileSettingKey = "dailyGoal" | "notifications";

export interface ProfileSettings {
  /** Daily practice goal, in minutes (5 / 10 / 20 — docs/04 §4.7). */
  dailyGoalMinutes: number;
  /** Whether reminder notifications are enabled. */
  notifications: boolean;
}

export interface ProfileScreenProps {
  user: ProfileUser;
  premium: ProfilePremium;
  /** The currently selected UI language. */
  language: AppLanguage;
  settings: ProfileSettings;
  /** Pick a UI language (uz / ru / en). */
  onChangeLanguage?: (language: AppLanguage) => void;
  /** Start the upgrade flow (only reachable on the free plan). */
  onUpgrade?: () => void;
  /** Open the editor for a settings row (daily goal / notifications). */
  onEditSetting?: (key: ProfileSettingKey) => void;
  /** Sign out (the danger action). */
  onLogout?: () => void;
  /** Active nav key (defaults to "profile"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  onToggleTheme?: (mode: ThemeMode) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ProfileScreen — the student's "Profil" place (docs/04 §4.9: Contact +
 * PremiumInfo folded into settings). Composed entirely from `shared/ui` +
 * `widgets` + tokens. Presentational and prop-driven: it fetches nothing and
 * owns no state.
 *
 * Layout is full-width (docs/04 §4.10): AppShell frame → identity card
 * (avatar · name · level · email) → premium-status card (free vs premium, with
 * an upgrade CTA when free) → language selector → settings list (daily goal ·
 * notifications · theme) → the logout danger action. Every colour / space /
 * radius / motion value is a token.
 */
export function ProfileScreen({
  user,
  premium,
  language,
  settings,
  onChangeLanguage,
  onUpgrade,
  onEditSetting,
  onLogout,
  activeNavKey = "profile",
  onNavigate,
  onToggleTheme,
}: ProfileScreenProps) {
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
        <Text as="h1" variant="title-m">
          {t("nav.profile")}
        </Text>
      }
      headerEnd={<ThemeToggle onChange={onToggleTheme} />}
    >
      <div className={styles.page}>
        <UserCard user={user} />

        <PremiumCard premium={premium} onUpgrade={onUpgrade} />

        <section className={styles.section} aria-label={t("profile.appLanguage")}>
          <Text
            as="h2"
            variant="label"
            color="faint"
            className={styles.sectionLabel}
          >
            {t("profile.language")}
          </Text>
          <LanguageSelector value={language} onChange={onChangeLanguage} />
        </section>

        <section className={styles.section} aria-label={t("profile.settings")}>
          <Text
            as="h2"
            variant="label"
            color="faint"
            className={styles.sectionLabel}
          >
            {t("profile.settings")}
          </Text>
          <ul className={styles.settingsList}>
            <li>
              <SettingRow
                tone="primary"
                icon={<TargetGlyph />}
                label={t("profile.dailyGoal")}
                description={t("profile.dailyGoalDesc")}
                value={t("units.minutes", { count: settings.dailyGoalMinutes })}
                onEdit={() => onEditSetting?.("dailyGoal")}
              />
            </li>
            <li>
              <SettingRow
                tone="info"
                icon={<BellGlyph />}
                label={t("profile.notifications")}
                description={t("profile.notificationsDesc")}
                value={settings.notifications ? t("profile.on") : t("profile.off")}
                onEdit={() => onEditSetting?.("notifications")}
              />
            </li>
            <li>
              <SettingRow
                tone="accent"
                icon={<ContrastGlyph />}
                label={t("profile.appearance")}
                description={t("profile.appearanceDesc")}
                control={<ThemeToggle onChange={onToggleTheme} />}
              />
            </li>
          </ul>
        </section>

        <div className={styles.logoutRow}>
          <Button variant="danger" onClick={onLogout}>
            <LogoutGlyph />
            {t("profile.logout")}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity card                                                              */
/* -------------------------------------------------------------------------- */

function UserCard({ user }: { user: ProfileUser }) {
  const { t } = useTranslation();
  const level = [user.level, user.levelLabel].filter(Boolean).join(" · ");
  return (
    <Card variant="raised" padding="lg" className={styles.userCard}>
      <span className={styles.avatar} aria-hidden>
        {user.avatarUrl ? (
          <img className={styles.avatarImg} src={user.avatarUrl} alt="" />
        ) : (
          initials(user.name)
        )}
      </span>

      <div className={styles.userMeta}>
        <div className={styles.userNameRow}>
          <Text as="h2" variant="title-l" truncate className={styles.userName}>
            {user.name}
          </Text>
          {user.verified && (
            <span className={styles.verified} title={t("profile.verified")}>
              <CheckGlyph />
              <VisuallyHidden>{t("profile.verifiedAccount")}</VisuallyHidden>
            </span>
          )}
          {user.level && (
            <Badge variant="primary" size="md">
              {user.level}
            </Badge>
          )}
        </div>

        <Text as="p" variant="body" color="muted" truncate>
          {user.email}
        </Text>

        {level && (
          <Text as="p" variant="body-s" color="faint">
            {t("profile.levelLine", { level })}
          </Text>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Premium status                                                             */
/* -------------------------------------------------------------------------- */

function PremiumCard({
  premium,
  onUpgrade,
}: {
  premium: ProfilePremium;
  onUpgrade?: () => void;
}) {
  const { t } = useTranslation();
  const active = premium.active;
  const plan = premium.planLabel ?? "Premium";
  const caption = active
    ? premium.renewsLabel
      ? `${plan} · ${premium.renewsLabel}`
      : t("profile.premiumAllOpen", { plan })
    : premium.attemptsLeft !== undefined
      ? t("profile.freeAttemptsLeft", { count: premium.attemptsLeft })
      : t("profile.premiumPitch");

  return (
    <Card variant="tint" padding="lg" className={styles.premiumCard}>
      <span className={styles.premiumIcon} aria-hidden>
        <CrownGlyph />
      </span>

      <div className={styles.premiumBody}>
        <div className={styles.premiumHead}>
          <Text as="p" variant="title-s">
            {active ? plan : t("profile.freePlan")}
          </Text>
          <Badge variant={active ? "success" : "neutral"} size="md">
            {active ? t("profile.active") : t("profile.free")}
          </Badge>
        </div>

        <Text as="p" variant="body-s" color="ink-soft">
          {caption}
        </Text>

        {!active && (
          <div className={styles.premiumActions}>
            <Button variant="primary" onClick={onUpgrade}>
              {t("profile.upgrade")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Language selector (presentational single-select)                           */
/* -------------------------------------------------------------------------- */

interface LanguageMeta {
  code: AppLanguage;
  /** Endonym (the language's own name). */
  native: string;
  /** Short latin caption. */
  caption: string;
}

const LANGUAGES: LanguageMeta[] = [
  { code: "uz", native: "O'zbekcha", caption: "Uzbek" },
  { code: "ru", native: "Русский", caption: "Russian" },
  { code: "en", native: "English", caption: "English" },
];

function LanguageSelector({
  value,
  onChange,
}: {
  value: AppLanguage;
  onChange?: (language: AppLanguage) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.langGroup} role="group" aria-label={t("profile.appLanguage")}>
      {LANGUAGES.map((lang) => {
        const selected = lang.code === value;
        return (
          <button
            key={lang.code}
            type="button"
            className={cx(styles.langOption, selected && styles.langOptionActive)}
            aria-pressed={selected}
            onClick={() => onChange?.(lang.code)}
          >
            <Text as="span" variant="title-s">
              {lang.native}
            </Text>
            <Text as="span" variant="body-s" color="muted">
              {lang.caption}
            </Text>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings row                                                               */
/* -------------------------------------------------------------------------- */

type SettingTone = "primary" | "info" | "accent";

interface SettingRowProps {
  tone: SettingTone;
  icon: ReactNode;
  label: string;
  description?: string;
  /** Current value caption (shown before the chevron on editable rows). */
  value?: string;
  /** Makes the whole row a button that opens the editor. */
  onEdit?: () => void;
  /** A trailing control (e.g. ThemeToggle) — the row is then static, not a button. */
  control?: ReactNode;
}

const SETTING_TONE: Record<SettingTone, string> = {
  primary: styles.settingIconPrimary,
  info: styles.settingIconInfo,
  accent: styles.settingIconAccent,
};

function SettingRow({
  tone,
  icon,
  label,
  description,
  value,
  onEdit,
  control,
}: SettingRowProps) {
  const inner = (
    <>
      <span className={cx(styles.settingIcon, SETTING_TONE[tone])} aria-hidden>
        {icon}
      </span>

      <span className={styles.settingText}>
        <Text as="span" variant="title-s">
          {label}
        </Text>
        {description && (
          <Text as="span" variant="body-s" color="muted">
            {description}
          </Text>
        )}
      </span>

      {control ? (
        <span className={styles.settingControl}>{control}</span>
      ) : (
        <span className={styles.settingValue}>
          {value && (
            <Text as="span" variant="body" color="ink-soft" weight="semibold">
              {value}
            </Text>
          )}
          <ChevronGlyph />
        </span>
      )}
    </>
  );

  // A trailing interactive control (theme toggle) keeps the row static so the
  // control is the only tap target — never a button nested in a button.
  if (onEdit && !control) {
    return (
      <Card variant="outline" padding="md" interactive asChild>
        <button type="button" className={styles.settingRow} onClick={onEdit}>
          {inner}
        </button>
      </Card>
    );
  }

  return (
    <Card variant="outline" padding="md" className={styles.settingRow}>
      {inner}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helpers                                                              */
/* -------------------------------------------------------------------------- */

/** First letters of up to two name words, uppercased (avatar fallback). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const chars = [parts[0], parts[parts.length - 1]]
    .slice(0, parts.length === 1 ? 1 : 2)
    .map((p) => p.charAt(0).toUpperCase());
  return chars.join("");
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 10 17l9-10"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrownGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        d="M4 8l4 4 4-6 4 6 4-4v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"
        fill="currentColor"
      />
    </svg>
  );
}

function TargetGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5H4.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10 19.5a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ContrastGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 3.8v16.4a8.2 8.2 0 0 0 0-16.4z" fill="currentColor" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg
      className={styles.chevron}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutGlyph() {
  return (
    <svg
      className={styles.glyph}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M15 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 12h9m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * ProfileScreenDemo — drop-in standalone preview wired to the mock fixture, so
 * the Profile screen renders end-to-end with no backend.
 */
export default function ProfileScreenDemo() {
  return (
    <ProfileScreen
      user={mockProfileUser}
      premium={mockPremium}
      language={mockLanguage}
      settings={mockSettings}
      onChangeLanguage={() => undefined}
      onUpgrade={() => undefined}
      onEditSetting={() => undefined}
      onLogout={() => undefined}
      onNavigate={() => undefined}
    />
  );
}
