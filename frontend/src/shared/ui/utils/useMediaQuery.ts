import { useEffect, useState } from "react";

/**
 * True while `query` matches. Reads synchronously on first render (no flash of the
 * wrong layout) and follows changes. Where `matchMedia` is missing it answers
 * false — the narrow, card layout, which works everywhere.
 */
export function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}

/** The AppShell `lg` breakpoint, where a data table replaces the cards. */
export const WIDE_QUERY = "(min-width: 1080px)";
