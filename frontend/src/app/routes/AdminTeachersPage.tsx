/**
 * AdminTeachersPage (`/admin/teachers`, `?tab=admins`) — O'qituvchilar | Adminlar.
 *
 *   • `GET    /api/admin/teachers?search=`  → the list (search also matches phone digits)
 *   • `POST   /api/admin/teachers`          → "O'qituvchi qo'shish"
 *   • `PATCH  /api/admin/teachers/{id}`     → rename, (de)activate
 *   • `PATCH  /api/admin/users/{id}/role`   → role change, and the add sheet's promotion
 *   • `DELETE /api/admin/teachers/{id}`     → PERMANENT, CASCADING
 *   • `GET    /api/admin/admins`            → the Adminlar segment
 *   • `GET    /api/groups?teacher_id=`       → a teacher's groups, in their manage sheet
 *   • `POST   /api/admin/groups/{id}/transfer` → "Guruhni o'tkazish" (a teacher leaves)
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
import type {
  AdminAccount,
  AdminGroupTransferApi,
  AdminPerson,
  AdminStaffTab,
} from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AdminTeacherResponse, AdminUserResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";
import { useDateFormat } from "../../shared/format";
import { newestFirst } from "./adminPeople";

const SEARCH_DEBOUNCE_MS = 250;

export default function AdminTeachersPage() {
  const onNavigate = useAdminNavHandler();
  const { t } = useTranslation();
  // "2 soat oldin" / "kecha" for a table cell — the shared relative format.
  const when = useDateFormat().relative;
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
  const [admins, setAdmins] = useState<AdminUserResponse[] | null>(null);
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
        groupCount: r.group_count ?? 0,
        studentCount: r.student_count ?? 0,
        createdAt: r.created_at,
        createdLabel: when(r.created_at),
      })),
    [rows, t, when],
  );

  const adminRows = useMemo<AdminAccount[] | null>(
    () =>
      admins === null
        ? null
        : admins.map((a) => ({
            id: a.id,
            fullName: a.full_name,
            phone: a.phone,
            isSelf: a.is_self,
          })),
    [admins],
  );

  // Stable identities: the sheet's group list refetches whenever loadGroups changes.
  // The targets are fetched UNFILTERED and fresh — the list on screen may be narrowed
  // by a search, and a suspended teacher would only earn an invalid_target_teacher.
  // A transfer refetches the list: nothing on a row changes, but the open sheet of
  // the old owner must not keep offering a group they no longer have.
  const groupTransfer = useMemo<AdminGroupTransferApi>(
    () => ({
      loadGroups: async (teacherId) =>
        (await endpoints.adminTeacherGroups(teacherId)).map((g) => ({
          id: g.id,
          name: g.name,
          memberCount: g.member_count,
        })),
      loadTargets: async () =>
        (await endpoints.adminTeachers())
          .filter((r) => r.is_active)
          .map((r) => ({ id: r.id, fullName: r.full_name })),
      transfer: async (groupId, toTeacherId) => {
        await endpoints.adminTransferGroup(groupId, toTeacherId);
        refetch();
      },
    }),
    [refetch],
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
      groupTransfer={groupTransfer}
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
