/**
 * AdminStudentsPage (`/admin/students`) — O'quvchilar.
 *
 *   • `GET    /api/admin/students?search=` → the list
 *   • `PATCH  /api/admin/students/{id}`    → rename, (de)activate, premium
 *   • `DELETE /api/admin/students/{id}`    → PERMANENT, CASCADING
 *
 * The premium switch here is the product's actual freemium lever: it grants or
 * revokes unlimited attempts for one account, with no payment record behind it,
 * because payments do not exist in this schema yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminPeopleScreen } from "../../screens/admin";
import type { AdminPerson } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AdminStudentResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";

const SEARCH_DEBOUNCE_MS = 250;

export default function AdminStudentsPage() {
  const onNavigate = useAdminNavHandler();
  const { t } = useTranslation();

  const [rows, setRows] = useState<AdminStudentResponse[]>([]);
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
      .adminStudents(term || undefined)
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
        // The phone is the real identity here; `email` is a synthesised
        // {phone}@govori.uz placeholder and would be noise in the row.
        contact: r.phone ?? r.email,
        meta: [r.region, t("admin.answerCount", { count: r.submission_count })]
          .filter(Boolean)
          .join(" · "),
        active: r.is_active,
        premium: r.is_premium,
        ownedCount: r.submission_count,
      })),
    [rows, t],
  );

  if (loading && rows.length === 0) return <PageLoading />;
  if (failed) return <PageError onRetry={refetch} />;

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
    />
  );
}
