import { useCallback, useId, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../../shared/api";
import { formatPhone } from "../../shared/format/phone";
import { Badge, Card, Spinner, Tabs, Text, VisuallyHidden } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, studentNavItems } from "../../widgets";
import type { NavItem, ThemeMode } from "../../widgets";
import { InfoTab } from "./tabs/InfoTab";
import type { InfoTabProps } from "./tabs/InfoTab";
import { ResultsTab } from "./tabs/ResultsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import {
  mockGroup,
  mockLinks,
  mockProfileAchievements,
  mockProfileUser,
  mockResults,
  mockStats,
} from "./profile.mock";
import styles from "./ProfileScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** The three inner places of Profil: Ma'lumot · Natijalar · Sozlamalar. */
export type ProfileTabKey = "info" | "results" | "settings";

/** The three UI languages offered (docs/04 §4.7 — onboarding step 1). */
export type AppLanguage = "uz" | "ru" | "en";

export interface ProfileUser {
  /** Display name (e.g. "Aziz Karimov"). */
  name: string;
  /** The real phone the account was created with. Null on legacy rows. */
  phone: string | null;
  /** Registration "Manzil" region (e.g. "Toshkent shahri"). */
  region: string | null;
  /** Registration "Manzil" district inside {@link region} (e.g. "Chilonzor
   * tumani"). Null until the address step or the Ma'lumot edit dialog sets it. */
  district: string | null;
  /** CEFR level badge (e.g. "A2"). Hidden when null — see `levelLabel`. */
  level: string | null;
  /** Human level caption (e.g. "boshlang'ich"), null exactly when `level` is. */
  levelLabel: string | null;
  /** Account creation timestamp, ISO-8601 — the "Ro'yxatdan o'tgan" row. */
  registeredAt: string;
  /** Avatar image URL. Falls back to initials derived from `name`. */
  avatarUrl?: string;
  /** Verified account — shows a success check beside the name. */
  verified?: boolean;
}

/** The student's group, or null when they learn independently. */
export interface ProfileGroup {
  /** Group name as shown in the tile (e.g. "B1 · Kechki-3"). */
  name: string;
  teacherName: string | null;
  memberCount: number;
}

/** The "Natijalar" tiles + the headline XP total. */
export interface ProfileStats {
  attempts: number;
  /** Average band 0–100, or null before the first graded attempt. */
  avgBand: number | null;
  currentStreak: number;
  /** Total practice seconds; rendered as hours to 1dp ("6.4 soat"). */
  totalPracticeSec: number;
  /** Lifetime XP — the headline gamification number, shown as the XP banner. */
  xp: number;
}

/** One row of "SO'NGGI NATIJALAR". */
export interface ProfileResult {
  id: string;
  title: string;
  band: number;
  createdAt: string;
  /** Direction versus the chronologically previous graded attempt. */
  trend: "up" | "down" | "flat";
}

/** One "YUTUQLAR" tile. `key` indexes the title in the locale files. */
export interface ProfileAchievement {
  key: string;
  progress: number;
  target: number;
  unlocked: boolean;
}

/** Outbound Telegram links behind the "Yordam markazi" sheet. */
export interface ProfileLinks {
  tgSupportUrl: string;
  tgChannelUrl: string;
}

export interface ProfileScreenProps {
  user: ProfileUser;
  /** Null → the group block is replaced by an "independent learner" state. */
  group: ProfileGroup | null;
  stats: ProfileStats;
  results: ProfileResult[];
  achievements: ProfileAchievement[];
  language: AppLanguage;
  theme: ThemeMode;
  notifications: boolean;
  /** Premium subscribers are never shown the Pro upsell card. */
  isPremium: boolean;
  /** Null while `/api/settings/links` is still in flight. */
  links: ProfileLinks | null;
  /** The cheapest real monthly plan's formatted price for the Pro card, or null for none. */
  proPriceFrom?: string | null;
  /**
   * Controlled tab selection. Omit both this and `onChangeTab` to let the
   * screen own the choice internally (the usual case).
   */
  activeTab?: ProfileTabKey;
  onChangeTab?: (key: ProfileTabKey) => void;
  onLeaveGroup?: () => void;
  /** Natijalar tab — open one attempt's detail (submission id). */
  onOpenResult?: (id: string) => void;
  /** Natijalar tab — open the full "Barcha natijalar" history. */
  onSeeAllResults?: () => void;
  /**
   * Ma'lumot tab — persist the edited name + viloyat + tuman, then refresh the
   * user. Omit it and the tab renders read-only (no "Tahrirlash" control).
   * See {@link InfoTabProps.onSaveInfo} for the reject-to-report contract.
   */
  onSaveInfo?: InfoTabProps["onSaveInfo"];
  /** Ma'lumot tab — phone change step 1 (send a code to the NEW number). Must
   * be supplied together with {@link onConfirmPhoneChange}. */
  onRequestPhoneChange?: InfoTabProps["onRequestPhoneChange"];
  /** Ma'lumot tab — phone change step 2 (confirm the Telegram-delivered code). */
  onConfirmPhoneChange?: InfoTabProps["onConfirmPhoneChange"];
  /**
   * Identity-card avatar — upload/replace the account photo from the picked file.
   * Omit it and the identity card renders read-only (no camera badge). The screen
   * stays presentational: ProfilePage owns the request + the auth-user refresh, so
   * a rejection (e.g. a server 400) must propagate for the card to show it inline.
   */
  onChangeAvatar?: (file: File) => Promise<void>;
  /** Identity-card avatar — remove the current photo. Only offered when the user
   * has an avatar. Like {@link onChangeAvatar}, rejections propagate to the card. */
  onRemoveAvatar?: () => Promise<void>;
  onChangeLanguage?: (language: AppLanguage) => void;
  onChangeTheme?: (theme: ThemeMode) => void;
  onChangeNotifications?: (on: boolean) => void;
  /** Start the upgrade flow (only reachable off the Pro card). */
  onUpgrade?: () => void;
  onLogout?: () => void;
  /** Active nav key (defaults to "profile"). */
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * ProfileScreen — the student's "Profil" place (docs/04 §4.9), split into the
 * three inner places the owner's mockup specifies: Ma'lumot (identity, address
 * and group), Natijalar (stats, recent results, achievements) and Sozlamalar
 * (preferences, the Pro upsell, help and sign-out).
 *
 * The identity card sits ABOVE the tab strip and is shared by all three tabs —
 * it scrolls away with the content rather than sticking, matching the mockup.
 * Everything below the strip is delegated to a tab component; this file owns
 * only the frame, the tab semantics and the prop distribution.
 *
 * Presentational and prop-driven: it fetches nothing and owns no server state.
 * The single piece of state it may own is which tab is showing, and even that
 * defers to `activeTab`/`onChangeTab` when the caller wants control. Layout is
 * full-width (docs/04 §4.10); every colour / space / radius / motion value is
 * a token.
 */
export function ProfileScreen({
  user,
  group,
  stats,
  results,
  achievements,
  language,
  theme,
  notifications,
  isPremium,
  links,
  activeTab,
  onChangeTab,
  onLeaveGroup,
  onOpenResult,
  onSeeAllResults,
  onSaveInfo,
  onRequestPhoneChange,
  onConfirmPhoneChange,
  onChangeAvatar,
  onRemoveAvatar,
  onChangeLanguage,
  onChangeTheme,
  onChangeNotifications,
  onUpgrade,
  proPriceFrom = null,
  onLogout,
  activeNavKey = "profile",
  onNavigate,
}: ProfileScreenProps) {
  const { t } = useTranslation();
  const panelId = useId();

  // Uncontrolled by default; `activeTab` wins the moment the caller passes one.
  const [ownTab, setOwnTab] = useState<ProfileTabKey>("info");
  const current = activeTab ?? ownTab;

  const selectTab = useCallback(
    (key: string) => {
      const next = key as ProfileTabKey;
      if (activeTab === undefined) setOwnTab(next);
      onChangeTab?.(next);
    },
    [activeTab, onChangeTab],
  );

  const items = [
    { key: "info", label: t("profile.tabs.info"), panelId },
    { key: "results", label: t("profile.tabs.results"), panelId },
    { key: "settings", label: t("profile.tabs.settings"), panelId },
  ];

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
      headerEnd={<NotificationsBell />}
    >
      <div className={styles.page}>
        <IdentityCard
          user={user}
          onChangeAvatar={onChangeAvatar}
          onRemoveAvatar={onRemoveAvatar}
        />

        <Tabs
          items={items}
          activeKey={current}
          onChange={selectTab}
          aria-label={t("nav.profile")}
        />

        {/* One panel node reused across tabs: the tab strip is the only thing
            that changes identity, so a single labelled region keeps assistive
            tech oriented instead of announcing three separate landmarks. */}
        <div
          id={panelId}
          role="tabpanel"
          tabIndex={-1}
          aria-label={t(`profile.tabs.${current}`)}
          className={styles.panel}
        >
          {current === "info" && (
            <InfoTab
              user={{
                name: user.name,
                phone: user.phone,
                region: user.region,
                district: user.district,
                level: user.level,
                levelLabel: user.levelLabel,
                registeredAt: user.registeredAt,
              }}
              group={group}
              onLeaveGroup={onLeaveGroup}
              onSaveInfo={onSaveInfo}
              onRequestPhoneChange={onRequestPhoneChange}
              onConfirmPhoneChange={onConfirmPhoneChange}
            />
          )}

          {current === "results" && (
            <ResultsTab
              stats={stats}
              results={results}
              achievements={achievements}
              onOpenResult={onOpenResult}
              onSeeAll={onSeeAllResults}
            />
          )}

          {current === "settings" && (
            <SettingsTab
              language={language}
              theme={theme}
              notifications={notifications}
              isPremium={isPremium}
              links={links}
              onChangeLanguage={onChangeLanguage}
              onChangeTheme={onChangeTheme}
              onChangeNotifications={onChangeNotifications}
              onUpgrade={onUpgrade}
              proPriceFrom={proPriceFrom}
              onLogout={onLogout}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity card — shared by all three tabs                                   */
/* -------------------------------------------------------------------------- */

/** Client-side avatar guards, mirroring the server: raster only (svg is rejected
 * as a stored-XSS vector), at most 5 MB. Enforced before upload so an obviously
 * bad pick fails instantly; the server re-checks regardless. */
const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The account card: avatar (with upload/replace/remove when the host supplies the
 * callbacks), name, verified check. EXPORTED because the teacher panel's own
 * profile shows the identical card — the account header is not a student concept,
 * and a second copy would drift the moment either gained a field.
 */
export function IdentityCard({
  user,
  onChangeAvatar,
  onRemoveAvatar,
}: {
  user: ProfileUser;
  onChangeAvatar?: (file: File) => Promise<void>;
  onRemoveAvatar?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = Boolean(onChangeAvatar);
  const removable = Boolean(user.avatarUrl) && Boolean(onRemoveAvatar);

  const openPicker = useCallback(() => {
    setError(null);
    fileRef.current?.click();
  }, []);

  const runAvatarError = useCallback(
    (err: unknown): string => {
      if (isApiError(err)) {
        // A network failure has status 0. A server 400 used to be shown as its
        // `detail` — Uzbek text on a Russian or English screen. The type and the
        // size are both checked here before the upload, so a 400 that still gets
        // through is the server's content sniff disagreeing with the file type.
        if (err.status === 0) return t("auth.errors.network");
        if (err.status === 400) return t("profile.avatar.errorType");
      }
      return t("auth.errors.generic");
    },
    [t],
  );

  const onFilePicked = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so re-picking the SAME file still fires `change`.
      e.target.value = "";
      if (!file || !onChangeAvatar) return;

      setError(null);
      if (!AVATAR_TYPES.includes(file.type)) {
        setError(t("profile.avatar.errorType"));
        return;
      }
      if (file.size > AVATAR_MAX_BYTES) {
        setError(t("profile.avatar.errorSize"));
        return;
      }

      setBusy(true);
      try {
        await onChangeAvatar(file);
      } catch (err) {
        setError(runAvatarError(err));
      } finally {
        setBusy(false);
      }
    },
    [onChangeAvatar, runAvatarError, t],
  );

  const onRemove = useCallback(async () => {
    if (!onRemoveAvatar) return;
    setError(null);
    setBusy(true);
    try {
      await onRemoveAvatar();
    } catch (err) {
      setError(runAvatarError(err));
    } finally {
      setBusy(false);
    }
  }, [onRemoveAvatar, runAvatarError]);

  return (
    <Card variant="raised" padding="lg" className={styles.identityCard}>
      <div className={styles.avatarBlock}>
        <span className={styles.avatar} aria-hidden>
          {user.avatarUrl ? (
            <img className={styles.avatarImg} src={user.avatarUrl} alt="" />
          ) : (
            initials(user.name)
          )}
        </span>

        {busy && (
          <span className={styles.avatarBusy}>
            <Spinner size="sm" label={t("profile.avatar.uploading")} />
          </span>
        )}

        {editable && (
          <>
            <button
              type="button"
              className={styles.avatarCameraBtn}
              onClick={openPicker}
              disabled={busy}
              aria-label={t("profile.avatar.change")}
            >
              <CameraGlyph />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_ACCEPT}
              className={styles.avatarInput}
              onChange={onFilePicked}
              aria-label={t("profile.avatar.aria")}
            />
          </>
        )}
      </div>

      <div className={styles.identityMeta}>
        <div className={styles.identityNameRow}>
          <Text as="h2" variant="title-l" truncate className={styles.identityName}>
            {user.name}
          </Text>
          {user.verified && (
            <span className={styles.verified} title={t("profile.verified")}>
              <CheckGlyph />
              <VisuallyHidden>{t("profile.verifiedAccount")}</VisuallyHidden>
            </span>
          )}
        </div>

        {user.phone && (
          <Text as="p" variant="body" color="muted" truncate>
            {formatPhone(user.phone)}
          </Text>
        )}

        {(removable || error) && (
          <div className={styles.avatarActions}>
            {removable && (
              <button
                type="button"
                className={styles.avatarRemoveBtn}
                onClick={onRemove}
                disabled={busy}
              >
                {t("profile.avatar.remove")}
              </button>
            )}
            {error && (
              <Text as="p" variant="body-s" color="danger" className={styles.avatarError} role="alert">
                {error}
              </Text>
            )}
          </div>
        )}
      </div>

      {user.level && (
        <Badge variant="primary" size="md" className={styles.identityLevel}>
          {user.level}
        </Badge>
      )}
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

function CameraGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 8.5a2 2 0 0 1 2-2h1l1-1.6a1.4 1.4 0 0 1 1.2-.65h4.6a1.4 1.4 0 0 1 1.2.65l1 1.6h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Default export — a self-wired demo, renderable in isolation.               */
/* -------------------------------------------------------------------------- */

/**
 * ProfileScreenDemo — drop-in standalone preview wired to the mock fixture, so
 * all three Profile tabs render end-to-end with no backend.
 */
export default function ProfileScreenDemo() {
  return (
    <ProfileScreen
      user={mockProfileUser}
      group={mockGroup}
      stats={mockStats}
      results={mockResults}
      achievements={mockProfileAchievements}
      language="uz"
      theme="light"
      notifications
      isPremium={false}
      links={mockLinks}
      onNavigate={() => undefined}
    />
  );
}
