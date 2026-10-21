import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge, DataTable, Text } from "../../shared/ui";
import type { DataTableColumn } from "../../shared/ui";
import { VisibilityBadge } from "./AdminContentExtras";
import styles from "./AdminModulesTable.module.css";

/** One module row — the subset of the blocks API the table reads. */
export interface AdminModuleRow {
  id: string;
  name: string;
  level: string | null;
  visibility: string;
  is_published: boolean;
  task_count: number;
  student_count: number;
  updated_at: string;
  owner_name?: string;
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

/**
 * The admin's Kontent › Modullar list on a wide screen: every teacher's modules in
 * one sortable table — author, visibility, status, level, tasks, reach, last edit.
 *
 * **Duplicates are shown, not hidden.** The admin list holds every teacher's
 * modules, and the same name authored by five teachers is a real situation (a
 * shared template copied per teacher) as much as a mess to tidy. Collapsing them
 * would hide whose is whose, so each copy stays a row, marked "Takror ×N", and the
 * default sort is by name so the copies sit together.
 */
export function AdminModulesTable({
  rows,
  onOpen,
  formatDate,
}: {
  rows: AdminModuleRow[];
  onOpen: (id: string) => void;
  /** The page's date formatter — the screen stays free of date logic. */
  formatDate: (iso: string) => string;
}) {
  const { t } = useTranslation();

  const dupes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(nameKey(r.name), (counts.get(nameKey(r.name)) ?? 0) + 1);
    return counts;
  }, [rows]);
  const dupeNames = useMemo(() => [...dupes.values()].filter((n) => n > 1).length, [dupes]);

  const columns = useMemo<DataTableColumn<AdminModuleRow>[]>(
    () => [
      {
        key: "name",
        header: t("admin.modulesTable.module"),
        rowHeader: true,
        width: "28%",
        sortValue: (r) => r.name,
        cell: (r) => {
          const n = dupes.get(nameKey(r.name)) ?? 1;
          return (
            <span className={styles.name}>
              <button
                type="button"
                className={styles.link}
                onClick={() => onOpen(r.id)}
                aria-label={t("admin.modulesTable.openName", { name: r.name })}
              >
                {r.name}
              </button>
              {n > 1 && (
                <span title={t("admin.modulesTable.duplicateHint", { count: n })}>
                  <Badge variant="warn" size="sm">
                    {t("admin.modulesTable.duplicate", { count: n })}
                  </Badge>
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: "author",
        header: t("admin.modulesTable.author"),
        sortValue: (r) => r.owner_name ?? null,
        cell: (r) => r.owner_name ?? "",
      },
      {
        key: "visibility",
        header: t("admin.modulesTable.visibility"),
        nowrap: true,
        sortValue: (r) => r.visibility,
        cell: (r) => <VisibilityBadge visibility={r.visibility} />,
      },
      {
        key: "status",
        header: t("admin.modulesTable.status"),
        nowrap: true,
        sortValue: (r) => (r.is_published ? 0 : 1),
        cell: (r) => (
          <Badge variant={r.is_published ? "success" : "neutral"} size="sm">
            {r.is_published ? t("teacher.statusActive") : t("teacher.statusDraft")}
          </Badge>
        ),
      },
      {
        key: "level",
        header: t("admin.modulesTable.level"),
        nowrap: true,
        sortValue: (r) => r.level,
        cell: (r) => r.level ?? <span className={styles.muted}>—</span>,
      },
      {
        key: "tasks",
        header: t("admin.modulesTable.tasks"),
        align: "end",
        nowrap: true,
        firstDir: "desc",
        sortValue: (r) => r.task_count,
        cell: (r) => r.task_count,
      },
      {
        key: "students",
        header: t("admin.modulesTable.students"),
        align: "end",
        nowrap: true,
        firstDir: "desc",
        // A draft reaches nobody: "—", never a 0 that reads like an empty roster.
        sortValue: (r) => (r.is_published ? r.student_count : null),
        cell: (r) => (r.is_published ? r.student_count : <span className={styles.muted}>—</span>),
      },
      {
        key: "updated",
        header: t("admin.modulesTable.updated"),
        nowrap: true,
        firstDir: "desc",
        sortValue: (r) => Date.parse(r.updated_at) || null,
        cell: (r) => formatDate(r.updated_at),
      },
    ],
    [t, dupes, onOpen, formatDate],
  );

  return (
    <div className={styles.wrap}>
      {dupeNames > 0 && (
        <Text as="p" variant="body-s" color="muted">
          {t("admin.modulesTable.duplicatesSummary", { count: dupeNames })}
        </Text>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption={t("admin.modulesTable.caption")}
        defaultSort={{ key: "name", dir: "asc" }}
        sortLabel={(h) => t("admin.table.sortBy", { column: String(h) })}
        rowClassName={(r) => ((dupes.get(nameKey(r.name)) ?? 1) > 1 ? styles.dupe : undefined)}
      />
    </div>
  );
}
