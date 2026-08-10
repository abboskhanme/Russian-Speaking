/**
 * TeacherProfilePage (`/teacher/profile`) — Phase 7. The destination of the A1
 * header avatar, which is the teacher panel's only profile entry (its nav bar is
 * `Bosh · Klasslar · Navbat · Kontent · Analitika`, with no Profil item).
 *
 *   • the account itself comes from the auth context (`GET /api/auth/me`)
 *   • `GET /api/groups` → "Guruhlarim"
 *
 * The avatar has navigated here since Phase 1; until this route existed the path
 * fell through to the `*` catch-all and bounced straight back to Obzor.
 *
 * Language and theme persist client-side (i18n's own store and the shared theme
 * module). `users.preferred_language` EXISTS as a column but nothing writes it —
 * see the plan's follow-up; until it is wired, a teacher's language choice does
 * not follow them to another device.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TeacherProfileScreen } from "../../screens/teacher";
import type { TeacherLanguage, TeacherProfileGroup } from "../../screens/teacher";
import { endpoints } from "../../shared/api";
import type { GroupResponse } from "../../shared/api";
import { useAuth } from "../../shared/auth";
import { setLang } from "../../shared/i18n";
import type { AppLang } from "../../shared/i18n";
import { dateParts } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { useTeacherNavHandler } from "../nav";

export default function TeacherProfilePage() {
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useTeacherNavHandler();

  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [queued, setQueued] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    // The queue count is fetched here purely for the nav FAB's badge. It is not
    // decoration: the badge is on every other teacher screen, so dropping it on
    // this one reads as "the queue emptied" rather than "this page didn't ask".
    Promise.allSettled([endpoints.teacherGroups(), endpoints.teacherReviewQueue(100)])
      .then(([g, q]) => {
        if (!alive) return;
        if (g.status === "fulfilled") setGroups(g.value);
        else setFailed(true);
        setQueued(q.status === "fulfilled" ? q.value.length : 0);
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const identity = useMemo(() => {
    // "qo'shilgan mart 2026" — the month NAME comes from `time.month*`, never from
    // Intl: Chromium's reduced ICU has no Uzbek months and renders "2026 M03".
    const parts = user ? dateParts(user.created_at) : null;
    const joined = parts
      ? t("teacher.profile.joined", {
          date: t("time.monthYear", {
            month: t(`time.month${parts.month}`),
            year: parts.year,
          }),
        })
      : undefined;

    return {
      fullName: user?.full_name ?? "",
      phone: user?.phone ?? null,
      joined,
    };
  }, [user, t]);

  const groupOptions = useMemo<TeacherProfileGroup[]>(
    () => groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.member_count })),
    [groups],
  );

  const language = (["uz", "ru", "en"] as const).includes(i18n.language as TeacherLanguage)
    ? (i18n.language as TeacherLanguage)
    : "uz";

  const onLogout = useCallback(() => {
    logout();
    navigate("/login", { replace: true });
  }, [logout, navigate]);

  if (loading) return <PageLoading />;
  if (failed || !user) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <TeacherProfileScreen
      identity={identity}
      groups={groupOptions}
      language={language}
      activeNavKey="home"
      onNavigate={onNavigate}
      queuedCount={queued}
      onBack={() => navigate("/teacher")}
      onChangeLanguage={(lang) => setLang(lang as AppLang)}
      onOpenGroup={(id) => navigate(`/teacher/classes/${id}`)}
      onLogout={onLogout}
    />
  );
}
