/**
 * cx — a dependency-free className joiner.
 *
 * The Ovoz DS plan (docs/03 §3.6, shared/ui/README) calls for `class-variance-
 * authority`, but this component tier must not pull new build-time deps (only
 * Radix primitives are allowed). `cx` covers the small surface those components
 * need: filter falsy values and join with a space.
 *
 * @example cx(styles.button, styles[variant], isFull && styles.full)
 */
export type ClassValue = string | number | false | null | undefined;

export function cx(...values: ClassValue[]): string {
  let out = "";
  for (const v of values) {
    if (!v) continue;
    out += out ? ` ${v}` : `${v}`;
  }
  return out;
}
