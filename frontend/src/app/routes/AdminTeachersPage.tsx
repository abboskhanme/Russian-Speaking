/**
 * AdminTeachersPage (`/admin/teachers`) — O'qituvchilar.
 *
 *   • `GET    /api/admin/teachers?search=` → the list
 *   • `PATCH  /api/admin/teachers/{id}`    → rename, (de)activate
 *   • `DELETE /api/admin/teachers/{id}`    → PERMANENT, CASCADING
 *
 * Every mutation refetches rather than patching local state: the row carries a
 * server-computed `question_count`, and guessing it here would drift from what the
 * next load shows — which matters, because that count is what the delete dialog
 * tells the operator they are about to destroy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminPeopleScreen } from "../../screens/admin";
import type { AdminPerson } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AdminTeacherResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";

const SEARCH_DEBOUNCE_MS = 250;

export default function AdminTeachersPage() {
  const onNavigate = useAdminNavHandler();
  const { t } = useTranslation();

  const [rows, setRows] = useState<AdminTeacherResponse[]>([]);
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    endpoints
      .adminTeachers(term || undefined)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setFailed(true))
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setSearching(false);
      });
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
      rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        contact: r.email,
        meta: t("teacher.taskCount", { count: r.question_count }),
        active: r.is_active,
        ownedCount: r.question_count,
      })),
    [rows, t],
  );

  if (loading && rows.length === 0) return <PageLoading />;
  if (failed) return <PageError onRetry={refetch} />;

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
    />
  );
}
