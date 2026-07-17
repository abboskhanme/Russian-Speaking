import type { ReactNode } from "react";
import { cx, VisuallyHidden } from "../../shared/ui";
import styles from "./Nav.module.css";

export interface NavItem {
  /** Stable identity, echoed back to `onNavigate` and matched against `activeKey`. */
  key: string;
  /** Visible label (and the accessible name for the emphasised FAB). */
  label: string;
  /** 24×24 inline SVG drawn with `currentColor` (see `./icons`). */
  icon: ReactNode;
  /** Render as a real link. When omitted the item is a `<button>`. */
  href?: string;
  /** Optional count / dot cue (inline pill on the sidebar, a dot on the icon otherwise). */
  badge?: ReactNode;
  /** Bottom-nav only: render as the raised centre FAB (the AI Suhbat CTA). */
  emphasized?: boolean;
}

export type NavVariant = "sidebar" | "bottom";

export interface NavProps {
  items: NavItem[];
  /** Key of the current item — gets `aria-current="page"` + active styling. */
  activeKey?: string;
  /** Called on activation with the item's key (and the item). */
  onNavigate?: (key: string, item: NavItem) => void;
  /** `sidebar` (vertical rail) or `bottom` (mobile bar). Default `sidebar`. */
  variant?: NavVariant;
  /**
   * Sidebar only: force icon-only (`true`) or always-labelled (`false`).
   * Left `undefined` the sidebar is responsive — icon-only 720–1079px,
   * labelled ≥1080px (docs/03 §3.8 md→lg).
   */
  collapsed?: boolean;
  /** Accessible name for the `<nav>` landmark. */
  label?: string;
  className?: string;
}

/**
 * Nav — the 5 student items (Bosh · Mashq · AI Suhbat · Progress · Profil),
 * presentational + prop-driven (docs/03 §3.8, §4.8). Keyboard-accessible via
 * native buttons/links in natural tab order; the active item carries
 * `aria-current="page"`. All colour / spacing / radius / motion from tokens.
 */
export function Nav({
  items,
  activeKey,
  onNavigate,
  variant = "sidebar",
  collapsed,
  label = "Asosiy navigatsiya",
  className,
}: NavProps) {
  const isBottom = variant === "bottom";

  return (
    <nav
      className={cx(
        styles.nav,
        isBottom ? styles.bottom : styles.sidebar,
        !isBottom && collapsed === true && styles.forceCollapsed,
        !isBottom && collapsed === false && styles.forceExpanded,
        className,
      )}
      aria-label={label}
    >
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key} className={styles.li}>
            <NavEntry
              item={item}
              active={item.key === activeKey}
              isBottom={isBottom}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface NavEntryProps {
  item: NavItem;
  active: boolean;
  isBottom: boolean;
  onNavigate?: (key: string, item: NavItem) => void;
}

function NavEntry({ item, active, isBottom, onNavigate }: NavEntryProps) {
  const isFab = isBottom && !!item.emphasized;
  const hasBadge = item.badge != null;

  const className = cx(
    isFab ? styles.fab : styles.item,
    !isFab && item.emphasized && styles.emphasized,
  );

  const icon = (
    <span className={styles.icon} aria-hidden>
      {item.icon}
      {isBottom && hasBadge && <span className={styles.badgeDot} />}
    </span>
  );

  const content = isFab ? (
    <>
      {icon}
      <VisuallyHidden>{item.label}</VisuallyHidden>
    </>
  ) : (
    <>
      {icon}
      <span className={styles.label}>{item.label}</span>
      {!isBottom && hasBadge && <span className={styles.badge}>{item.badge}</span>}
    </>
  );

  const ariaCurrent = active ? ("page" as const) : undefined;
  const handleClick = () => onNavigate?.(item.key, item);

  if (item.href != null) {
    return (
      <a href={item.href} className={className} aria-current={ariaCurrent} onClick={handleClick}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={className} aria-current={ariaCurrent} onClick={handleClick}>
      {content}
    </button>
  );
}
