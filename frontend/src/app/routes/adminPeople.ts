/**
 * Shared by the two admin people pages.
 *
 * The API lists accounts OLDEST first (`ORDER BY created_at`), which buries the
 * question an admin actually opens the list with — "who just joined?" — under years
 * of history, and the list shows only its first 50 rows. So the pages flip it here.
 * Stable for equal timestamps, and an unparsable one sinks to the end rather than
 * throwing the whole order off.
 */
export function newestFirst<T extends { created_at: string }>(rows: readonly T[]): T[] {
  const at = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };
  return rows
    .map((row, index) => ({ row, index, ms: at(row.created_at) }))
    .sort((a, b) => b.ms - a.ms || a.index - b.index)
    .map((x) => x.row);
}
