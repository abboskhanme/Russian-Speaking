import { useMemo } from "react";
import { qrMatrix, qrPath } from "./qr";
import styles from "./QrCode.module.css";

export interface QrCodeProps {
  /** What the code encodes (an invite URL). */
  value: string;
  /** Accessible name, e.g. "QR code for the invite link". */
  label: string;
  className?: string;
}

/**
 * QrCode — an SVG QR code from the in-house encoder (./qr.ts). Always dark
 * modules on a white plate with the 4-module quiet zone, in BOTH themes: phone
 * scanners expect dark-on-light, and an inverted code fails on many of them.
 * Scales to its container (crisp at any projector size — it is vector).
 */
export function QrCode({ value, label, className }: QrCodeProps) {
  const { d, size } = useMemo(() => qrPath(qrMatrix(value)), [value]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={[styles.qr, className].filter(Boolean).join(" ")}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} className={styles.plate} />
      <path d={d} className={styles.modules} />
    </svg>
  );
}
