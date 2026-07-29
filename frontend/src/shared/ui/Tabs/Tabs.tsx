import { forwardRef, useRef } from "react";
import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { cx } from "../utils/cx";
import styles from "./Tabs.module.css";

export interface TabItem {
  /** Stable identity; compared against `activeKey` and passed to `onChange`. */
  key: string;
  label: ReactNode;
  /** Skipped by arrow-key navigation and not selectable. */
  disabled?: boolean;
  /** `id` of the panel this tab controls, when the consumer renders one. */
  panelId?: string;
}

export interface TabsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  items: TabItem[];
  /** Controlled selection — the `key` of the active item. */
  activeKey: string;
  onChange: (key: string) => void;
  /**
   * Label the tablist for screen readers. Pass this or `aria-labelledby`;
   * a segmented control with no name is announced as bare "tab list".
   */
  "aria-label"?: string;
}

/** Next enabled index in `dir`, wrapping around; `from` itself is never returned. */
function step(items: TabItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  for (let i = 1; i <= n; i += 1) {
    const next = (from + dir * i + n * i) % n;
    if (!items[next]?.disabled) return next;
  }
  return from;
}

/** First (`dir` 1) or last (`dir` -1) enabled index. */
function edge(items: TabItem[], dir: 1 | -1): number {
  const order =
    dir === 1
      ? items.map((_, i) => i)
      : items.map((_, i) => items.length - 1 - i);
  for (const i of order) {
    if (!items[i]?.disabled) return i;
  }
  return 0;
}

/**
 * Tabs — the segmented pill control (docs/03 §3.6 Containment).
 *
 * Real tab semantics: `role="tablist"` / `role="tab"` / `aria-selected`, roving
 * tabindex (only the active tab is in the tab order) and arrow-key navigation
 * with automatic activation — ←/→ (and ↑/↓) move and select, Home/End jump to
 * the ends. Controlled only; the consumer owns `activeKey`.
 *
 * The panels are rendered by the consumer: give each panel `role="tabpanel"`
 * plus an `id` matching the item's `panelId`.
 */
export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { items, activeKey, onChange, className, ...props },
  ref,
) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = items.findIndex((item) => item.key === activeKey);
  // With no match (e.g. a key that no longer exists) keep one tab reachable.
  const rovingIndex = activeIndex === -1 ? edge(items, 1) : activeIndex;

  const select = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    tabRefs.current[index]?.focus();
    if (item.key !== activeKey) onChange(item.key);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = step(items, index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = step(items, index, -1);
        break;
      case "Home":
        next = edge(items, 1);
        break;
      case "End":
        next = edge(items, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next);
  };

  return (
    <div
      ref={ref}
      role="tablist"
      aria-orientation="horizontal"
      className={cx(styles.list, className)}
      {...props}
    >
      {items.map((item, index) => {
        const selected = index === activeIndex;
        return (
          <button
            key={item.key}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={item.panelId ? `${item.panelId}-tab` : undefined}
            aria-selected={selected}
            aria-controls={item.panelId}
            tabIndex={index === rovingIndex ? 0 : -1}
            disabled={item.disabled}
            className={cx(styles.tab, selected && styles.active)}
            onClick={() => select(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
});
