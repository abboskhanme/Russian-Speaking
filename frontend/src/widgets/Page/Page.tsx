import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx, Text } from "../../shared/ui";
import styles from "./Page.module.css";

/**
 * What a role layout hands down to the page it frames: the DOM node of the top
 * bar's leading slot. `null` until the layout has mounted — and absent entirely
 * when a screen is rendered on its own (a test, a route that opted out of the
 * layout), in which case {@link Page} falls back to drawing its title inline.
 */
export interface PageChromeValue {
  headerSlot: HTMLElement | null;
}

export const PageChromeContext = createContext<PageChromeValue | null>(null);

/** True inside a role layout (the shell is already on screen). */
export function useInRoleLayout(): boolean {
  return useContext(PageChromeContext) != null;
}

/**
 * Content width.
 *
 *   reading — ~920px column for reading and form pages (profile, settings, detail
 *             screens): keeps key/value rows, bars and buttons at a readable size.
 *   wide    — ~1200px for dashboards, card grids and tables.
 *   full    — no cap (an editor or a canvas that genuinely wants the room).
 */
export type PageWidth = "reading" | "wide" | "full";

export interface PageProps {
  /** The page's ONE title. It is the page's `<h1>` and sits in the layout's top bar,
   * so a screen must not repeat it as a heading in its body. */
  title?: ReactNode;
  /** Free-form top-bar leading content (a back button, or back + title) — used
   * instead of `title` by drill-down screens whose hero carries the heading. */
  headerStart?: ReactNode;
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}

/**
 * Page — one screen's content inside its role layout (`app/routes/RoleLayout`).
 *
 * The layout owns the frame (sidebar, bottom bar, top bar, the bell + avatar
 * cluster); the page owns only what is specific to it: its title (portalled into
 * the top bar, so there is exactly one title per page, in one place) and the width
 * its content should use.
 *
 * Outside a layout the title renders inline as the body's first heading, so a
 * screen still reads correctly on its own.
 */
export function Page({ title, headerStart, width = "reading", className, children }: PageProps) {
  const chrome = useContext(PageChromeContext);

  const head =
    headerStart != null || title != null ? (
      <div className={styles.head}>
        {headerStart}
        {title != null && (
          <Text as="h1" variant="title-m" truncate className={styles.title}>
            {title}
          </Text>
        )}
      </div>
    ) : null;

  return (
    <>
      {head && chrome?.headerSlot && createPortal(head, chrome.headerSlot)}
      <div className={cx(styles.page, styles[width], className)}>
        {head && !chrome && <div className={styles.inlineHead}>{head}</div>}
        {children}
      </div>
    </>
  );
}
