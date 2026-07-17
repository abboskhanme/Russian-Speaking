/**
 * shared/ui — Ovoz Design System component library (barrel).
 *
 * The single design system (docs/03 §3.6). Every component is built on
 * `shared/styles/tokens.css` (colour / type / space / radius / shadow / motion)
 * with light + dark inherited from the tokens. Import tokens.css + fonts.css
 * once at the app root so these `var(--…)` references resolve.
 *
 * First tier (this sprint):
 *   Actions     — Button
 *   Forms       — Input
 *   Containment — Card
 *   Data        — Badge
 *   Feedback    — Spinner, Skeleton
 *   Foundations — Text, VisuallyHidden
 */
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Card } from "./Card";
export type { CardProps, CardVariant, CardPadding } from "./Card";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeVariant, BadgeSize } from "./Badge";

export { Spinner } from "./Spinner";
export type { SpinnerProps, SpinnerSize } from "./Spinner";

export { Skeleton } from "./Skeleton";
export type { SkeletonProps, SkeletonShape } from "./Skeleton";

export { Text } from "./Text";
export type {
  TextProps,
  TextVariant,
  TextColor,
  TextWeight,
  TextTag,
} from "./Text";

export { VisuallyHidden } from "./VisuallyHidden";
export type { VisuallyHiddenProps } from "./VisuallyHidden";

export { cx } from "./utils/cx";
export type { ClassValue } from "./utils/cx";
