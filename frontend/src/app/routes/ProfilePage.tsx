/**
 * ProfilePage (`/profile`) — the real Profile, wired across its three tabs.
 *
 * Identity comes from the auth store (`GET /api/auth/me`), which now also
 * carries the phone, the registration date and the CEFR level derived from the
 * student's graded attempts. The Natijalar tab is backed by `/api/profile/stats
 * · /results · /achievements`; the group block by `/api/groups/mine`; the help
 * sheet by the public `/api/settings/links`.
 *
 * The four secondary fetches are deliberately fault-tolerant: a failure in any
 * one of them degrades that section to an empty state instead of blanking the
 * whole page, because identity alone is enough to render something useful. Only
 * a missing user is a hard error.
 *
 * Language persists through i18n, theme through the shared theme module, and
 * notifications through `PATCH /api/auth/me` — they used to be session-local and
 * forgot the choice on every reload, which is exactly the bug a settings switch
 * must not have.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ProfileScreen } from "../../screens/profile";
import type {
  AppLanguage,
  EditableInfo,
  ProfileAchievement,
  ProfileGroup,
  ProfileLinks,
  ProfileResult,
  ProfileStats,
  ProfileUser,
} from "../../screens/profile";
import { endpoints } from "../../shared/api";
import { getLang, setLang } from "../../shared/i18n";
import { useAuth } from "../../shared/auth";
import { applyTheme, getEffectiveTheme, storeTheme } from "../../widgets";
import type { ThemeMode } from "../../widgets";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

export default function ProfilePage() {
  const onNavigate = useNavHandler();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { user, logout, loadMe, hydrateUser } = useAuth();

  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [achievements, setAchievements] = useState<ProfileAchievement[]>([]);
  const [group, setGroup] = useState<ProfileGroup | null>(null);
  const [links, setLinks] = useState<ProfileLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [theme, setTheme] = useState<ThemeMode>(() => getEffectiveTheme());
  // No settings endpoint yet → local state (persists for the session).
  // Mirrors the stored preference so the switch can move at once; the request
  // then confirms it. Seeded from the user the auth store already holds.
  const [notifications, setNotifications] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    // `allSettled`, not `all`: one dead section must not blank the page.
    Promise.allSettled([
      endpoints.profileStats(),
      endpoints.profileResults(),
      endpoints.profileAchievements(),
      endpoints.myGroups(),
      endpoints.settingsLinks(),
    ])
      .then(([s, r, a, g, l]) => {
        if (!alive) return;

        setStats(
          s.status === "fulfilled"
            ? {
                attempts: s.value.attempts,
                avgBand: s.value.avg_band,
                currentStreak: s.value.current_streak,
                totalPracticeSec: s.value.total_practice_sec,
                xp: s.value.xp,
              }
            : null,
        );

        setResults(
          r.status === "fulfilled"
            ? r.value.map((row) => ({
                id: row.id,
                title: row.title,
                band: row.band,
                createdAt: row.created_at,
                trend: row.trend,
              }))
            : [],
        );

        setAchievements(
          a.status === "fulfilled"
            ? a.value.map((row) => ({
                key: row.key,
                progress: row.progress,
                target: row.target,
                unlocked: row.unlocked,
              }))
            : [],
        );

        // A student belongs to at most one group in practice; take the first.
        const mine = g.status === "fulfilled" ? g.value[0] : undefined;
        setGroup(
          mine
            ? {
                name: mine.name,
                teacherName: mine.teacher_name,
                memberCount: mine.member_count,
              }
            : null,
        );

        setLinks(
          l.status === "fulfilled"
            ? {
                tgSupportUrl: l.value.tg_support_url,
                tgChannelUrl: l.value.tg_channel_url,
              }
            : null,
        );
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  // Adopt the stored preference whenever identity (re)loads.
  useEffect(() => {
    if (user) setNotifications(user.notifications_enabled);
  }, [user]);

  /** Optimistic: the switch moves at once, because a settings toggle that waits
   * on a round-trip feels broken. A failure puts it back where it was — the one
   * outcome worse than a slow switch is one that lies about what was saved. */
  const changeNotifications = useCallback(
    (next: boolean) => {
      const previous = notifications;
      setNotifications(next);
      endpoints
        .updateProfile({ notifications_enabled: next })
        .then(loadMe)
        .catch(() => setNotifications(previous));
    },
    [notifications, loadMe],
  );

  /** Apply immediately, then persist to the ACCOUNT so the choice follows the
   * user to another device. Theme stays per-device on purpose — a phone in the
   * dark and a laptop in daylight are not the same environment. */
  const changeLanguage = useCallback(
    (lang: AppLanguage) => {
      const previous = getLang();
      setLang(lang);
      endpoints
        .updateProfile({ preferred_language: lang })
        .then(loadMe)
        .catch(() => setLang(previous));
    },
    [loadMe],
  );

  const changeTheme = useCallback((next: ThemeMode) => {
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  }, []);

  const handleLeaveGroup = useCallback(() => {
    // Optimistic: the group block disappears at once, and a failure restores it
    // on the next load rather than leaving the student in limbo.
    setGroup(null);
    endpoints
      .leaveGroup()
      .catch(() => setReloadKey((k) => k + 1));
  }, []);

  /* ---- Ma'lumot tab: the two editing flows ------------------------------ *
   * The tab is presentational, so every request lives here. All three handlers
   * deliberately let the rejection through: the dialog is what decides whether
   * a 409 means "already registered" or a 401 means "wrong code", and it keeps
   * itself open to say so. Swallowing the error here would close the dialog as
   * if the change had landed.
   *
   * `loadMe()` re-reads `/api/auth/me` THROUGH the auth store, so the header,
   * the identity card and the info rows all repaint from one source — updating
   * local state instead would leave the header showing the old name/phone. */

  const handleSaveInfo = useCallback(
    async ({ fullName, region, district }: EditableInfo) => {
      await endpoints.updateProfile({
        full_name: fullName,
        // PATCH is tri-state: `undefined` leaves the stored value alone. The
        // dialog only ever hands back an empty region together with an empty
        // district, so the pair is written (or skipped) as a unit and can never
        // end up half-updated.
        region: region || undefined,
        district: district || undefined,
      });
      await loadMe();
    },
    [loadMe],
  );

  const handleRequestPhoneChange = useCallback(
    (phoneE164: string) => endpoints.phoneChangeRequest(phoneE164),
    [],
  );

  const handleConfirmPhoneChange = useCallback(
    async (code: string) => {
      await endpoints.phoneChangeConfirm(code);
      // The user id is unchanged, so the session survives — only identity has
      // to be re-read.
      await loadMe();
    },
    [loadMe],
  );

  /* ---- Identity card: avatar upload / remove ---------------------------- *
   * The card is presentational, so the requests live here. Both endpoints
   * return the fresh MeResponse (with a re-signed avatar_url), so `hydrateUser`
   * adopts it directly — one source repaints the identity card, the header and
   * the rows, with no second `/me` round-trip. The rejection is deliberately let
   * through so the card can surface a server 400 inline instead of crashing. */

  const handleChangeAvatar = useCallback(
    async (file: File) => {
      const updated = await endpoints.uploadAvatar(file);
      hydrateUser(updated);
    },
    [hydrateUser],
  );

  const handleRemoveAvatar = useCallback(async () => {
    const updated = await endpoints.removeAvatar();
    hydrateUser(updated);
  }, [hydrateUser]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const language = ((["uz", "ru", "en"] as const).includes(i18n.language as AppLanguage)
    ? i18n.language
    : "uz") as AppLanguage;

  if (loading) return <PageLoading />;
  // Identity is the one thing the screen cannot render without.
  if (!user) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  const profileUser: ProfileUser = {
    name: user.full_name,
    phone: user.phone,
    region: user.region,
    district: user.district,
    level: user.level,
    levelLabel: user.level_label,
    registeredAt: user.created_at,
    avatarUrl: user.avatar_url ?? undefined,
    verified: user.is_active,
  };

  return (
    <ProfileScreen
      user={profileUser}
      group={group}
      stats={
        stats ?? {
          attempts: 0,
          avgBand: null,
          currentStreak: 0,
          totalPracticeSec: 0,
          xp: 0,
        }
      }
      results={results}
      achievements={achievements}
      onOpenResult={(id) => navigate(`/results/${id}`)}
      onSeeAllResults={() => navigate("/results")}
      language={language}
      theme={theme}
      notifications={notifications}
      isPremium={user.is_premium}
      links={links}
      onLeaveGroup={handleLeaveGroup}
      onSaveInfo={handleSaveInfo}
      onRequestPhoneChange={handleRequestPhoneChange}
      onConfirmPhoneChange={handleConfirmPhoneChange}
      onChangeAvatar={handleChangeAvatar}
      onRemoveAvatar={handleRemoveAvatar}
      onChangeLanguage={changeLanguage}
      onChangeTheme={changeTheme}
      onChangeNotifications={changeNotifications}
      onUpgrade={() => undefined}
      onLogout={handleLogout}
      activeNavKey="profile"
      onNavigate={onNavigate}
    />
  );
}
