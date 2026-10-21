import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, Card, Input, Spinner, Text } from "../../shared/ui";
import { AppShell, Brand, NotificationsBell, adminNavItems } from "../../widgets";
import type { NavItem } from "../../widgets";
import { AdminAccountButton } from "./AdminChrome";
import styles from "./AdminAuditScreen.module.css";

/* -------------------------------------------------------------------------- */
/* Public contract                                                            */
/* -------------------------------------------------------------------------- */

/** One successful admin action, as the screen reads it. */
export interface AdminAuditEntry {
  id: string;
  createdAt: string;
  actorId: string;
  /** Null when the acting account has since been deleted — the row outlives it. */
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  /** The target's name at the time (so a deleted teacher still reads as a name). */
  targetLabel: string | null;
  /** Request fields the admin SENT — for a settings save, which keys changed. */
  fields: string[];
  /** Values for the server's allow-list only. A secret's value is never here. */
  values: Record<string, string>;
  ip: string | null;
}

/** The filters, as plain strings so they bind straight to form controls. "" = off.
 * `actorName` only labels the chip; the server filters on `actorId`. */
export interface AdminAuditFilters {
  action: string;
  from: string;
  to: string;
  actorId: string;
  actorName?: string;
}

export interface AdminAuditProps {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  filters: AdminAuditFilters;
  /** A refetch in flight. The list stays on screen (dimmed) so the filters do not jump. */
  loading?: boolean;
  /** The last refetch failed; the previous rows are still shown. */
  failed?: boolean;
  onFiltersChange?: (next: AdminAuditFilters) => void;
  onPageChange?: (page: number) => void;
  activeNavKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
}

export const EMPTY_AUDIT_FILTERS: AdminAuditFilters = { action: "", from: "", to: "", actorId: "" };

/** The action-prefix filter's options. The server matches a PREFIX, and the action
 * names are dotted for exactly this — `settings` is every settings change. */
const ACTION_GROUPS = ["teacher", "student", "user", "module", "task", "plan", "settings"] as const;

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * AdminAuditScreen — **Jurnal**: who did what in the admin panel.
 *
 * Read-only, and that is the product, not a gap: the trail is written server-side by
 * the audited routes themselves, append-only in the database, so nothing on this
 * screen could edit it even if it tried.
 *
 * Three things here are deliberate:
 *
 *  • **Field names, never secret values.** A settings save shows WHICH keys changed
 *    (`gemini_api_key`), because that is all the server keeps. The screen does not
 *    soften this into "AI settings changed": the key name is exactly the useful part.
 *  • **The actor is a filter.** Tapping a name narrows the list to that admin — the
 *    question an audit is opened for is usually "what else did they do?", and a
 *    people picker would be a second screen to answer it.
 *  • **Times are Tashkent wall-clock**, matching the date filters (product days) and
 *    every other date in the app; a browser-local time would disagree with the filter
 *    for anyone reading it from another zone.
 */
export function AdminAuditScreen({
  entries,
  total,
  page,
  pageSize,
  filters,
  loading = false,
  failed = false,
  onFiltersChange,
  onPageChange,
  activeNavKey = "audit",
  onNavigate,
}: AdminAuditProps) {
  const { t } = useTranslation();
  const actionId = useId();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const filtered = Boolean(filters.action || filters.from || filters.to || filters.actorId);

  const set = (patch: Partial<AdminAuditFilters>) => onFiltersChange?.({ ...filters, ...patch });

  return (
    <AppShell
      brand={<Brand />}
      nav={{
        items: adminNavItems(t),
        activeKey: activeNavKey,
        onNavigate,
        label: t("nav.landmark"),
      }}
      headerStart={
        <Text as="h1" variant="title-m">
          {t("admin.audit.title")}
        </Text>
      }
      headerEnd={
        <>
          <NotificationsBell />
          <AdminAccountButton />
        </>
      }
    >
      <div className={styles.page} data-density="compact">
        <Text as="p" variant="body-s" color="muted">
          {t("admin.audit.intro")}
        </Text>

        {/* ---- Filters ---- */}
        <section className={styles.filters} aria-label={t("admin.audit.filters")}>
          <div className={styles.field}>
            <label htmlFor={actionId} className={styles.label}>
              {t("admin.audit.filterAction")}
            </label>
            <select
              id={actionId}
              className={styles.select}
              value={filters.action}
              onChange={(e) => set({ action: e.target.value })}
            >
              <option value="">{t("admin.audit.filterAll")}</option>
              {ACTION_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {groupLabel(group, t)}
                </option>
              ))}
            </select>
          </div>
          <Input
            type="date"
            label={t("admin.audit.from")}
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
          />
          <Input
            type="date"
            label={t("admin.audit.to")}
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
          />
        </section>

        {(filters.actorId || filtered) && (
          <div className={styles.chips}>
            {filters.actorId && (
              <Badge variant="primary" size="md">
                {t("admin.audit.actorOnly", { name: filters.actorName || shortId(filters.actorId) })}
              </Badge>
            )}
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => onFiltersChange?.(EMPTY_AUDIT_FILTERS)}>
                {t("admin.audit.clear")}
              </Button>
            )}
          </div>
        )}

        {failed && (
          <Text as="p" variant="body-s" color="danger" role="alert">
            {t("admin.audit.loadFailed")}
          </Text>
        )}

        {/* ---- The trail ---- */}
        <section className={styles.section} aria-label={t("admin.audit.title")} aria-busy={loading}>
          <div className={styles.sectionHead}>
            <Text as="h2" variant="label" color="muted" className={styles.legend}>
              {t("admin.audit.count", { count: total })}
            </Text>
            {loading && <Spinner size="sm" label={t("common.loading")} />}
          </div>

          {entries.length === 0 ? (
            <Card variant="outline" padding="md">
              <Text as="p" variant="body" color="muted">
                {filtered ? t("admin.audit.emptyFiltered") : t("admin.audit.empty")}
              </Text>
            </Card>
          ) : (
            <Card variant="outline" padding="none">
              <ul className={styles.list} data-loading={loading || undefined}>
                {entries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    onActor={
                      onFiltersChange
                        ? () =>
                            set({
                              actorId: entry.actorId,
                              actorName: entry.actorName ?? undefined,
                            })
                        : undefined
                    }
                  />
                ))}
              </ul>
            </Card>
          )}

          {pages > 1 && (
            <nav className={styles.pager} aria-label={t("admin.audit.pages")}>
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => onPageChange?.(page - 1)}
              >
                {t("admin.audit.prev")}
              </Button>
              <Text as="span" variant="body-s" color="muted" numeric>
                {t("admin.audit.pageOf", { page, pages })}
              </Text>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages || loading}
                onClick={() => onPageChange?.(page + 1)}
              >
                {t("admin.audit.next")}
              </Button>
            </nav>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* One row                                                                    */
/* -------------------------------------------------------------------------- */

function AuditRow({ entry, onActor }: { entry: AdminAuditEntry; onActor?: () => void }) {
  const { t } = useTranslation();
  const actor = entry.actorName ?? t("admin.audit.deletedActor");
  const target = entry.targetLabel ?? entry.targetId;
  const valueKeys = Object.keys(entry.values);
  // A field whose value is shown below is not listed again as a bare name.
  const bareFields = entry.fields.filter((f) => !(f in entry.values));

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <Text as="span" variant="body" weight="semibold">
          {actionLabel(entry.action, t)}
        </Text>
        <Text as="span" variant="body-s" color="muted" numeric>
          <time dateTime={entry.createdAt}>{formatTashkent(entry.createdAt)}</time>
        </Text>
      </div>

      {target && (
        <Text as="p" variant="body-s" color="ink-soft" className={styles.target}>
          {target}
        </Text>
      )}

      {(valueKeys.length > 0 || bareFields.length > 0) && (
        <div className={styles.details}>
          {valueKeys.map((key) => (
            <Badge key={key} variant="neutral" size="sm">
              {key}: {entry.values[key]}
            </Badge>
          ))}
          {bareFields.length > 0 && (
            <Text as="span" variant="body-s" color="muted">
              {t("admin.audit.fields", { fields: bareFields.join(", ") })}
            </Text>
          )}
        </div>
      )}

      <div className={styles.meta}>
        {onActor ? (
          <button
            type="button"
            className={styles.actor}
            onClick={onActor}
            aria-label={t("admin.audit.filterByActor", { name: actor })}
          >
            {actor}
          </button>
        ) : (
          <Text as="span" variant="body-s">
            {actor}
          </Text>
        )}
        {entry.ip && (
          <Text as="span" variant="body-s" color="muted" numeric>
            {t("admin.audit.ip", { ip: entry.ip })}
          </Text>
        )}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Labels and formatting                                                      */
/* -------------------------------------------------------------------------- */

/** Every action the server records, as words. Literal `t()` calls on purpose: the
 * locale coverage test reads keys from the source and cannot see a built key. An
 * action this build does not know yet shows its raw dotted name — honest, and
 * still searchable. */
export function actionLabel(action: string, t: TFunction): string {
  switch (action) {
    case "teacher.create":
      return t("admin.audit.action.teacherCreate");
    case "teacher.update":
      return t("admin.audit.action.teacherUpdate");
    case "teacher.delete":
      return t("admin.audit.action.teacherDelete");
    case "student.update":
      return t("admin.audit.action.studentUpdate");
    case "student.delete":
      return t("admin.audit.action.studentDelete");
    case "user.role_change":
      return t("admin.audit.action.roleChange");
    case "settings.ai.update":
      return t("admin.audit.action.aiUpdate");
    case "settings.ai.test":
      return t("admin.audit.action.aiTest");
    case "settings.features.update":
      return t("admin.audit.action.featuresUpdate");
    case "settings.links.update":
      return t("admin.audit.action.linksUpdate");
    case "settings.secret_reveal":
      return t("admin.audit.action.secretReveal");
    case "plan.create":
      return t("admin.audit.action.planCreate");
    case "plan.update":
      return t("admin.audit.action.planUpdate");
    case "plan.delete":
      return t("admin.audit.action.planDelete");
    case "module.create":
      return t("admin.audit.action.moduleCreate");
    case "module.update":
      return t("admin.audit.action.moduleUpdate");
    case "module.delete":
      return t("admin.audit.action.moduleDelete");
    case "task.create":
      return t("admin.audit.action.taskCreate");
    case "task.update":
      return t("admin.audit.action.taskUpdate");
    case "task.delete":
      return t("admin.audit.action.taskDelete");
    case "task.media_set":
      return t("admin.audit.action.taskMediaSet");
    case "task.media_remove":
      return t("admin.audit.action.taskMediaRemove");
    default:
      return action;
  }
}

function groupLabel(group: (typeof ACTION_GROUPS)[number], t: TFunction): string {
  switch (group) {
    case "teacher":
      return t("admin.audit.group.teacher");
    case "student":
      return t("admin.audit.group.student");
    case "user":
      return t("admin.audit.group.user");
    case "module":
      return t("admin.audit.group.module");
    case "task":
      return t("admin.audit.group.task");
    case "plan":
      return t("admin.audit.group.plan");
    case "settings":
      return t("admin.audit.group.settings");
  }
}

const TASHKENT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `2026-10-21T09:37:00Z` → `2026-10-21 14:37` (Tashkent, UTC+5, no DST). */
export function formatTashkent(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    TASHKENT.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Demo host for the screen gallery — mock data, no network. */
export default function AdminAuditDemo() {
  return (
    <AdminAuditScreen
      entries={[
        {
          id: "a-1",
          createdAt: "2026-10-21T09:37:00Z",
          actorId: "u-1",
          actorName: "Admin Demo",
          action: "student.update",
          targetType: "user",
          targetId: "s-1",
          targetLabel: "Dilnoza Karimova",
          fields: ["is_premium"],
          values: { is_premium: "true" },
          ip: "10.0.0.1",
        },
        {
          id: "a-2",
          createdAt: "2026-10-21T09:12:00Z",
          actorId: "u-1",
          actorName: "Admin Demo",
          action: "settings.ai.update",
          targetType: "settings",
          targetId: null,
          targetLabel: null,
          fields: ["gemini_api_key"],
          values: {},
          ip: "10.0.0.1",
        },
      ]}
      total={2}
      page={1}
      pageSize={50}
      filters={EMPTY_AUDIT_FILTERS}
    />
  );
}
