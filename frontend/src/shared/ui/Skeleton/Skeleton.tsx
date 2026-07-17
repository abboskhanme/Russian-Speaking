import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "../utils/cx";
import styles from "./Skeleton.module.css";

export type SkeletonShape = "text" | "rect" | "circle";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shape?: SkeletonShape;
  /** CSS width (e.g. `"100%"`, `240`, `"12ch"`). Numbers → px. */
  width?: number | string;
  /** CSS height (e.g. `40`, `"2rem"`). Numbers → px. */
  height?: number | string;
  /** For `shape="circle"`, sets both width and height. Numbers → px. */
  size?: number | string;
}

function dim(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Skeleton — loading placeholder (docs/03 §3.6 Feedback).
 * Decorative by design: hidden from assistive tech. Announce the *loading state*
 * elsewhere (e.g. an `aria-live` region), not via a wall of skeletons.
 */
export function Skeleton({
  shape = "text",
  width,
  height,
  size,
  className,
  style,
  ...props
}: SkeletonProps) {
  const resolved = shape === "circle" && size !== undefined ? size : undefined;
  const mergedStyle: CSSProperties = {
    width: dim(resolved ?? width),
    height: dim(resolved ?? height),
    ...style,
  };
  return (
    <div
      className={cx(styles.skeleton, styles[shape], className)}
      style={mergedStyle}
      aria-hidden
      {...props}
    />
  );
}
