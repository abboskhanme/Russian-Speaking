/**
 * AdminTeachersPage (`/admin/teachers`, `?tab=admins`) — O'qituvchilar | Adminlar.
 *
 *   • `GET    /api/admin/teachers?search=`  → the list (search also matches phone digits)
 *   • `POST   /api/admin/teachers`          → "O'qituvchi qo'shish"
 *   • `PATCH  /api/admin/teachers/{id}`     → rename, (de)activate
 *   • `PATCH  /api/admin/users/{id}/role`   → role change, and the add sheet's promotion
 *   • `DELETE /api/admin/teachers/{id}`     → PERMANENT, CASCADING
 *   • `GET    /api/admin/admins`            → the Adminlar segment
 *
 * Most mutations refetch rather than patching local state: the row carries a
 * server-computed `question_count`, and guessing it here would drift from what the
 * next load shows — which matters, because that count is what the delete dialog
 * tells the operator they are about to destroy. The one exception is a CREATE: the
 * server answers with the finished row, so it goes straight to the top of the list
 * and the admin sees their new teacher without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AdminPeopleScreen } from "../../screens/admin";
import type { AdminAccount, AdminPerson, AdminStaffTab } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AdminTeacherResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";
import { newestFirst } from "./adminPeople";

const SEARCH_DEBOUNCE_MS = 250;

export default function AdminTeachersPage() {
  const onNavigate = useAdminNavHandler();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: AdminStaffTab = params.get("tab") === "admins" ? "admins" : "teachers";

  const [rows, setRows] = useState<AdminTeacherResponse[]>([]);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  // "Has the list ever loaded", not "is a request in flight": a refetch after a write
  // must not swap the screen for a spinner — that unmounts the open sheet and, on a
  // fresh install with zero teachers, flashes a blank page after every add.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [admins, setAdmins] = useState<AdminTeacherResponse[] | null>(null);
  const [adminsFailed, setAdminsFailed] = useState(false);
  const [adminsKey, setAdminsKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);
  const refetchAdmins = useCallback(() => setAdminsKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    endpoints
      .adminTeachers(term || undefined)
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

  // The Adminlar segment is fetched only when it is open — most visits never look.
  useEffect(() => {
    if (tab !== "admins") return;
    let alive = true;
    setAdminsFailed(false);
    setAdmins(null);
    endpoints
      .adminAdmins()
      .then((r) => alive && setAdmins(r))
      .catch(() => alive && setAdminsFailed(true));
    return () => {
      alive = false;
    };
  }, [tab, adminsKey]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const search = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    setSearching(true);
    timer.current = window.setTimeout(() => setTerm(next), SEARCH_DEBOUNCE_MS);
  }, []);

  const setTab = useCallback(
    (next: AdminStaffTab) => {
      const p = new URLSearchParams(params);
      if (next === "teachers") p.delete("tab");
      else p.set("tab", next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );

  const people = useMemo<AdminPerson[]>(
    () =>
      newestFirst(rows).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        // The phone is the real identity; `email` is a synthesised `{phone}@govori.uz`
        // placeholder, kept only for a legacy account that has no phone at all.
        contact: r.phone ?? r.email,
        meta: t("teacher.taskCount", { count: r.question_count }),
        active: r.is_active,
        ownedCount: r.question_count,
      })),
    [rows, t],
  );

  const adminRows = useMemo<AdminAccount[] | null>(
    () =>
      admins === null
        ? null
        : admins.map((a) => ({
            id: a.id,
            fullName: a.full_name,
            phone: a.phone,
            isSelf: a.is_self === true,
          })),
    [admins],
  );

  if (failed) return <PageError onRetry={refetch} />;
  if (!loaded) return <PageLoading />;

  return (
    <AdminPeopleScreen
      kind="teachers"
      people={people}
      searching={searching}
      activeNavKey="teachers"
      onNavigate={onNavigate}
      onSearch={search}
      onRename={async (id, fullName) => {
        await endpoints.adminUpdateTeacher(id, { full_name: fullName });
        refetch();
      }}
      onSetActive={async (id, active) => {
        await endpoints.adminUpdateTeacher(id, { is_active: active });
        refetch();
      }}
      onDelete={async (id) => {
        await endpoints.adminDeleteTeacher(id);
        refetch();
      }}
      onCreateTeacher={async ({ phone, fullName }) => {
        const created = await endpoints.adminCreateTeacher({ phone, full_name: fullName });
        setRows((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
      }}
      onPromoteStudent={async (userId) => {
        await endpoints.adminChangeRole(userId, "teacher");
        refetch();
      }}
      onChangeRole={async (id, role) => {
        await endpoints.adminChangeRole(id, role);
        // Either list can change: teacher → admin moves a row from one to the other.
        refetch();
        refetchAdmins();
      }}
      staff={{
        tab,
        onTabChange: setTab,
        admins: adminRows,
        adminsFailed,
        onRetryAdmins: refetchAdmins,
      }}
    />
  );
}
