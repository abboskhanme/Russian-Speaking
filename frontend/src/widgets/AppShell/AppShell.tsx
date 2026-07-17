import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../shared/ui";
import { Nav } from "../Nav";
import type { NavItem } from "../Nav";
import styles from "./AppShell.module.css";

export interface AppShellNav {
  items: NavItem[];
  activeKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Accessible name for the nav landmarks (default: "Asosiy navigatsiya"). */
  label?: string;
}

export interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  /** Logo / wordmark — sidebar header on desktop, top bar on mobile. */
  brand?: ReactNode;
  /** Navigation model, forwarded to `<Nav>` (both the sidebar and bottom bar). */
  nav: AppShellNav;
  /** Top-bar leading slot — page title / breadcrumbs. */
  headerStart?: ReactNode;
  /** Top-bar trailing slot — streak / XP, `<ThemeToggle>`, user menu. */
  headerEnd?: ReactNode;
  /** xl-only contextual right rail (streak, keyingi vazifa — docs/03 §3.8). */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * AppShell — the responsive student frame (docs/03 §3.8, §4.8).
 *
 * Desktop: left rail (icon-only 72px at md → 250px labelled at lg) + content,
 * plus an xl-only right rail. Mobile (<720px): sticky top bar + content +
 * fixed 5-item bottom bar (AI Suhbat is the raised centre FAB).
 *
 * Presentational + prop-driven — no routing/data coupling. Both nav landmarks
 * are rendered; CSS `display:none` keeps exactly one in the a11y tree per
 * breakpoint. Surfaces/spacing/elevation come from tokens; the full-width rule
 * holds (no `max-width` + auto margins on the content root — §3.8).
 */
export function AppShell({
  brand,
  nav,
  headerStart,
  headerEnd,
  aside,
  className,
  children,
  ...props
}: AppShellProps) {
  const navLabel = nav.label ?? "Asosiy navigatsiya";

  return (
    <div className={cx(styles.shell, className)} {...props}>
      <div className={styles.sidebar}>
        {brand && <div className={styles.brandSidebar}>{brand}</div>}
        <Nav
          className={styles.sidebarNav}
          variant="sidebar"
          label={navLabel}
          items={nav.items}
          activeKey={nav.activeKey}
          onNavigate={nav.onNavigate}
        />
      </div>

      <div className={styles.main}>
        <header className={styles.topbar}>
          {brand && <div className={styles.brandTopbar}>{brand}</div>}
          {headerStart && <div className={styles.headerStart}>{headerStart}</div>}
          <div className={styles.spacer} />
          {headerEnd && <div className={styles.headerEnd}>{headerEnd}</div>}
        </header>

        <div className={styles.body}>
          <main className={styles.content}>{children}</main>
          {aside && (
            <aside className={styles.aside} aria-label="Yordamchi panel">
              {aside}
            </aside>
          )}
        </div>
      </div>

      <div className={styles.bottomBar}>
        <Nav
          variant="bottom"
          label={navLabel}
          items={nav.items}
          activeKey={nav.activeKey}
          onNavigate={nav.onNavigate}
        />
      </div>
    </div>
  );
}
