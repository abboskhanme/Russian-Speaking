/**
 * shared/ui — Ovoz Design System component library (barrel).
 *
 * The single design system (docs/03 §3.6). Every component is built on
 * `shared/styles/tokens.css` (colour / type / space / radius / shadow / motion)
 * with light + dark inherited from the tokens. Import tokens.css + fonts.css
 * once at the app root so these `var(--…)` references resolve.
 *
 * First tier (this sprint):
 *   Actions     — Button, Switch
 *   Forms       — Input
 *   Containment — Card, Tabs, Modal
 *   Data        — Badge, StatTile
 *   Feedback    — Spinner, Skeleton
 *   Foundations — Text, VisuallyHidden
 *   Resilience  — ErrorBoundary
 */
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Card } from "./Card";
export type { CardProps, CardVariant, CardPadding } from "./Card";

export { Tabs } from "./Tabs";
export type { TabsProps, TabItem } from "./Tabs";

export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeVariant, BadgeSize } from "./Badge";

export { StatTile } from "./StatTile";
export type { StatTileProps, StatTileSize } from "./StatTile";

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

/* Resilience — the screen a person meets when a render throws (see its header). */
export { ErrorBoundary } from "./ErrorBoundary";
export type { ErrorBoundaryProps } from "./ErrorBoundary";

/* Domain-specific — the core interaction (docs/03 §3.6, docs/08 §4.6) */
export { Mascot } from "./Mascot";
export type { MascotProps, MascotMood } from "./Mascot";

export { Waveform } from "./Waveform";
export type { WaveformProps, WaveformMode } from "./Waveform";

export { FlowingWaveform } from "./FlowingWaveform/FlowingWaveform";
export type { FlowingWaveformProps } from "./FlowingWaveform/FlowingWaveform";

export { Recorder } from "./Recorder";
export type { RecorderProps, RecorderLabels } from "./Recorder";

export { copyText } from "./utils/copyText";
export { cx } from "./utils/cx";
export type { ClassValue } from "./utils/cx";

/* Learner motivation — a round meter with a centred slot, and Govo + one CTA
 * for an empty place. */
export { ProgressRing } from "./ProgressRing";
export type { ProgressRingProps, ProgressRingTone } from "./ProgressRing";

export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
