import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../utils/cx";
import { Card } from "../Card/Card";
import type { CardVariant } from "../Card/Card";
import { Text } from "../Text/Text";
import styles from "./StatTile.module.css";

export type StatTileSize = "md" | "lg";

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  /** The number itself — rendered tabular so a row of tiles stays aligned. */
  value: ReactNode;
  /** Small trailing unit, e.g. "soat". Sits on the value's baseline. */
  unit?: ReactNode;
  /** Muted caption beneath the value, e.g. "Urinishlar". */
  label: ReactNode;
  size?: StatTileSize;
  /** Surface treatment, forwarded to `Card`. */
  variant?: CardVariant;
}

/**
 * StatTile — the big-number card (docs/03 §3.6 Data).
 *
 * Purely presentational: it renders whatever `value` it is handed, already
 * formatted (rounding, "6.4", "—" for no data) by the caller. A tile is never
 * interactive; wrap it or use `Card interactive` if a stat must be clickable.
 */
export const StatTile = forwardRef<HTMLDivElement, StatTileProps>(
  function StatTile(
    { value, unit, label, size = "md", variant = "flat", className, ...props },
    ref,
  ) {
    return (
      <Card
        ref={ref}
        variant={variant}
        padding="md"
        className={cx(styles.tile, className)}
        {...props}
      >
        <Text
          as="p"
          variant={size === "lg" ? "display" : "title-l"}
          numeric
          className={styles.value}
        >
          {value}
          {unit != null && <span className={styles.unit}>{unit}</span>}
        </Text>
        <Text variant="body-s" color="muted" className={styles.label}>
          {label}
        </Text>
      </Card>
    );
  },
);
