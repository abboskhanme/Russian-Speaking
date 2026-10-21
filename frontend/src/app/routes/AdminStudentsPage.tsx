/**
 * AdminStudentsPage (`/admin/students`) — O'quvchilar.
 *
 *   • `GET    /api/admin/students?search=` → the list
 *   • `PATCH  /api/admin/students/{id}`    → rename, (de)activate, premium
 *   • `PATCH  /api/admin/users/{id}/role`  → student → teacher
 *   • `DELETE /api/admin/students/{id}`    → PERMANENT, CASCADING
 *
 * The premium switch here is a GRANT: unlimited attempts for one account with no
 * payment record behind it — the same `is_premium` a teacher can flip for their own
 * students. Paid subscriptions are a separate source (the billing tables, shown on
 * Tariflar); either one unlocks premium, and revoking this switch leaves a paid
 * subscription in place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminPeopleScreen } from "../../screens/admin";
import type { AdminPerson } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AdminStudentResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";
import { newestFirst, useRelativeLabel } from "./adminPeople";

const SEARCH_DEBOUNCE_MS = 250;

export default function AdminStudentsPage() {
  const onNavigate = useAdminNavHandler();
  const { t } = useTranslation();
  const when = useRelativeLabel();

  const [rows, setRows] = useState<AdminStudentResponse[]>([]);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  // Ever loaded, not "in flight" — a refetch after a write must not swap the screen
  // for a spinner and unmount the sheet the admin is working in.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    endpoints
      .adminStudents(term || undefined)
      .then((r) => {
        if (!alive) return;
        setRows(r);
        setLoaded(true);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, [reloadKey, term]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const search = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    setSearching(true);
    timer.current = window.setTimeout(() => setTerm(next), SEARCH_DEBOUNCE_MS);
  }, []);

  const people = useMemo<AdminPerson[]>(
    () =>
      newestFirst(rows).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        // The phone is the real identity here; `email` is a synthesised
        // {phone}@govori.uz placeholder and would be noise in the row.
        contact: r.phone ?? r.email,
        meta: [r.region, t("admin.answerCount", { count: r.submission_count })]
          .filter(Boolean)
          .join(" · "),
        active: r.is_active,
        premium: r.is_premium,
        ownedCount: r.submission_count,
        lastActiveAt: r.last_active_at ?? null,
        lastActiveLabel: r.last_active_at ? when(r.last_active_at) : undefined,
        avgBand: r.avg_band ?? null,
        groups: (r.groups ?? []).map((g) => ({ id: g.id, name: g.name, teacherName: g.teacher_name })),
        createdAt: r.created_at,
      })),
    [rows, t, when],
  );

  if (failed) return <PageError onRetry={refetch} />;
  if (!loaded) return <PageLoading />;

  return (
    <AdminPeopleScreen
      kind="students"
      people={people}
      searching={searching}
      activeNavKey="students"
      onNavigate={onNavigate}
      onSearch={search}
      onRename={async (id, fullName) => {
        await endpoints.adminUpdateStudent(id, { full_name: fullName });
        refetch();
      }}
      onSetActive={async (id, active) => {
        await endpoints.adminUpdateStudent(id, { is_active: active });
        refetch();
      }}
      onSetPremium={async (id, premium) => {
        await endpoints.adminUpdateStudent(id, { is_premium: premium });
        refetch();
      }}
      onDelete={async (id) => {
        await endpoints.adminDeleteStudent(id);
        refetch();
      }}
      // Student → teacher. The row leaves this list; the screen says where it went.
      onChangeRole={async (id, role) => {
        await endpoints.adminChangeRole(id, role);
        refetch();
      }}
    />
  );
}
