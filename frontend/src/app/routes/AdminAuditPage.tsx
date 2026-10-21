/**
 * AdminAuditPage (`/admin/audit`) — Jurnal.
 *
 *   • `GET /api/admin/audit` (?actor_id, action, from, to, page, page_size) → one page,
 *     newest first, plus the total
 *
 * Only the FIRST load is a full-page state. After that a refetch (a filter, a page)
 * keeps the previous rows on screen and dims them: blanking the list to a spinner on
 * every filter change would also unmount the filter controls the admin is using.
 */
import { useEffect, useState } from "react";
import { AdminAuditScreen, EMPTY_AUDIT_FILTERS } from "../../screens/admin";
import type { AdminAuditEntry, AdminAuditFilters } from "../../screens/admin";
import { endpoints } from "../../shared/api";
import type { AdminAuditEntryResponse } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useAdminNavHandler } from "../nav";

const PAGE_SIZE = 50;

function toEntry(r: AdminAuditEntryResponse): AdminAuditEntry {
  return {
    id: r.id,
    createdAt: r.created_at,
    actorId: r.actor_id,
    actorName: r.actor_name,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    targetLabel: r.target_label,
    fields: r.fields ?? [],
    values: r.values ?? {},
    ip: r.ip,
  };
}

export default function AdminAuditPage() {
  const onNavigate = useAdminNavHandler();
  const [filters, setFilters] = useState<AdminAuditFilters>(EMPTY_AUDIT_FILTERS);
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AdminAuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    endpoints
      .adminAudit({
        actor_id: filters.actorId || undefined,
        action: filters.action || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      .then((res) => {
        if (!alive) return;
        setEntries(res.items.map(toEntry));
        setTotal(res.total);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [filters, page, reloadKey]);

  if (entries === null) {
    if (failed) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;
    return <PageLoading />;
  }

  return (
    <AdminAuditScreen
      entries={entries}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filters={filters}
      loading={loading}
      failed={failed}
      // A new filter is a new list: page 3 of the old one may not exist in it.
      onFiltersChange={(next) => {
        setFilters(next);
        setPage(1);
      }}
      onPageChange={setPage}
      activeNavKey="audit"
      onNavigate={onNavigate}
    />
  );
}
