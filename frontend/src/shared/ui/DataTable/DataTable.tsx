import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Skeleton } from "../Skeleton";
import { VisuallyHidden } from "../VisuallyHidden";
import { cx } from "../utils/cx";
import styles from "./DataTable.module.css";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDirection;
}

export interface DataTableColumn<T> {
  /** Stable identity; also the sort key. */
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /**
   * Present ⇒ the column is sortable. Return `null`/`undefined` for "no value":
   * those rows always sink to the end, whichever way the column is sorted —
   * "never active" is not the oldest activity, and an unscored student is not a 0.
   */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Direction of the FIRST click. Numbers and dates usually want `desc`. */
  firstDir?: SortDirection;
  align?: "start" | "end" | "center";
  /** CSS width (e.g. `"8rem"`, `"12%"`). */
  width?: string;
  /** The header is read to screen readers but not drawn (an actions column). */
  hideHeader?: boolean;
  /** Keep the cell on one line (numbers, dates, badges, actions). End-aligned
   * columns never wrap anyway. */
  nowrap?: boolean;
  /** The cell that names the row: rendered as `<th scope="row">`. One per table. */
  rowHeader?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Names the table for screen readers (visually hidden). */
  caption: string;
  /** Uncontrolled initial sort. Without it, rows keep the order they came in. */
  defaultSort?: SortState;
  /** Controlled sort; pair with `onSortChange`. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** First load: skeleton rows instead of data. */
  loading?: boolean;
  /** Rendered across the full width when `rows` is empty (and not loading). */
  empty?: ReactNode;
  /** Highlight a row (e.g. a duplicate) — returns a class or nothing. */
  rowClassName?: (row: T) => string | undefined;
  /** Sort-button label for screen readers: "Sort by {column}". */
  sortLabel?: (header: ReactNode) => string;
  className?: string;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorted copy: stable for ties, empty values last in BOTH directions. */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => string | number | null | undefined,
  dir: SortDirection,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      const aEmpty = a.v === null || a.v === undefined || a.v === "";
      const bEmpty = b.v === null || b.v === undefined || b.v === "";
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1;
      return sign * compare(a.v as string | number, b.v as string | number) || a.index - b.index;
    })
    .map((x) => x.row);
}

function SortIcon({ dir }: { dir?: SortDirection }) {
  return (
    <svg className={styles.sortIcon} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5 9 5H3z" className={cx(styles.arrow, dir === "asc" && styles.arrowOn)} />
      <path d="M6 10.5 3 7h6z" className={cx(styles.arrow, dir === "desc" && styles.arrowOn)} />
    </svg>
  );
}

/**
 * DataTable — the dense list for wide screens (docs/03 §3.6 Data).
 *
 * A real `<table>`: a caption, `<th scope="col">` headers, one `<th scope="row">`
 * per row, so a screen reader can announce "Name, Aziz Karimov · Groups, 2" while
 * moving through cells. Sortable headers are buttons inside the `<th>` carrying
 * `aria-sort` — Tab reaches them, Enter/Space sorts, and the state is announced.
 * The header sticks under the app's top bar while the page scrolls.
 *
 * It is the ≥1080px view only. Below that the screens keep their cards: eight
 * columns do not fit a phone, and a horizontally scrolling table on a phone is a
 * table nobody reads.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  defaultSort,
  sort: controlled,
  onSortChange,
  loading,
  empty,
  rowClassName,
  sortLabel,
  className,
}: DataTableProps<T>) {
  const [own, setOwn] = useState<SortState | null>(defaultSort ?? null);
  const sort = controlled !== undefined ? controlled : own;

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sortValue || !sort) return rows;
    return sortRows(rows, col.sortValue, sort.dir);
  }, [rows, columns, sort]);

  const toggle = (col: DataTableColumn<T>) => {
    const next: SortState =
      sort?.key === col.key
        ? { key: col.key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.firstDir ?? "asc" };
    if (controlled === undefined) setOwn(next);
    onSortChange?.(next);
  };

  const alignClass = (a?: "start" | "end" | "center") =>
    a === "end" ? styles.end : a === "center" ? styles.center : undefined;
  const cellClass = (c: DataTableColumn<T>) =>
    cx(alignClass(c.align), (c.nowrap || c.align === "end") && styles.nowrap);

  return (
    <div className={cx(styles.wrap, className)}>
      <table className={styles.table} aria-busy={loading || undefined}>
        <caption>
          <VisuallyHidden>{caption}</VisuallyHidden>
        </caption>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key ? sort.dir : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={alignClass(c.align)}
                  aria-sort={
                    c.sortValue ? (active === "asc" ? "ascending" : active === "desc" ? "descending" : "none") : undefined
                  }
                >
                  {c.hideHeader ? (
                    <VisuallyHidden>{c.header}</VisuallyHidden>
                  ) : c.sortValue ? (
                    <button
                      type="button"
                      className={cx(styles.sortBtn, active && styles.sortActive)}
                      onClick={() => toggle(c)}
                      aria-label={sortLabel ? sortLabel(c.header) : undefined}
                    >
                      <span className={styles.headText}>{c.header}</span>
                      <SortIcon dir={active} />
                    </button>
                  ) : (
                    <span className={styles.headText}>{c.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }, (_, i) => (
              <tr key={`sk-${i}`} aria-hidden="true">
                {columns.map((c) => (
                  <td key={c.key}>
                    <Skeleton width={c.rowHeader ? "70%" : "50%"} />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.emptyCell}>
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) =>
                  c.rowHeader ? (
                    <th key={c.key} scope="row" className={cx(styles.rowHead, cellClass(c))}>
                      {c.cell(row)}
                    </th>
                  ) : (
                    <td key={c.key} className={cellClass(c)}>
                      {c.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
