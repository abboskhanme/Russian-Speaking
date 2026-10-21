/**
 * app/PageState — a full-screen loading / error / empty state for the data
 * routes (docs/08 auth slice, priority #5). Keeps the wired pages from ever
 * crashing on a slow or failed fetch: a Spinner while loading, a friendly Card
 * with a Retry on failure, and an optional empty slot. Tokens only.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Mascot, Spinner, Text } from "../shared/ui";
import { useInRoleLayout } from "../widgets/Page";

const fullStyle = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  background: "var(--bg)",
  padding: "24px",
} as const;

/** Inside a role layout the frame is already on screen: fill the content area, not
 * the viewport (and the page background is already there). */
const inLayoutStyle = { ...fullStyle, minHeight: "50vh", background: "transparent" } as const;

function useShellStyle() {
  return useInRoleLayout() ? inLayoutStyle : fullStyle;
}

export function PageLoading() {
  const shellStyle = useShellStyle();
  const { t } = useTranslation();
  return (
    <div style={shellStyle}>
      <Spinner size="lg" label={t("common.loading")} />
    </div>
  );
}

export function PageError({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const shellStyle = useShellStyle();
  const { t } = useTranslation();
  return (
    <div style={shellStyle}>
      <Card
        variant="raised"
        padding="lg"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          textAlign: "center",
          maxWidth: 420,
        }}
      >
        <Mascot mood="sleepy" size={72} label="Govo" />
        <Text as="h2" variant="title-m">
          {t("errors.loadTitle")}
        </Text>
        <Text as="p" variant="body-l" color="ink-soft">
          {message ?? t("errors.loadBody")}
        </Text>
        {onRetry && (
          <Button variant="primary" size="lg" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        )}
      </Card>
    </div>
  );
}

/** A tiny fixed-position toast used by Practice for submit success / errors. */
export function Toast({ tone, children }: { tone: "success" | "danger" | "info"; children: ReactNode }) {
  const bg =
    tone === "success" ? "var(--primary)" : tone === "danger" ? "var(--danger)" : "var(--surface-3)";
  const fg = tone === "info" ? "var(--ink)" : "var(--primary-on, #fff)";
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 96,
        transform: "translateX(-50%)",
        zIndex: 60,
        background: bg,
        color: fg,
        padding: "12px 18px",
        borderRadius: 14,
        boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
        maxWidth: "min(92vw, 480px)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
