/**
 * ErrorBoundary — what a person sees when a render throws.
 *
 * WHY THIS EXISTS. React unmounts the whole tree when a render, a lifecycle or a
 * constructor throws and nothing above it catches. Until this component existed the
 * app had no boundary anywhere, so a single bad field on one API response — a `null`
 * where a string was typed, a `.map` on `undefined` — replaced the entire product
 * with a blank white page, on a phone, with no way back except knowing to pull down
 * and reload. That is the failure mode this closes.
 *
 * ## What the fallback does and does not say
 *
 * The message is a sentence, not a stack. In production a stack trace tells the
 * person nothing they can act on and tells anyone reading over their shoulder our
 * file layout, so `showDetails` defaults to `import.meta.env.DEV` and the message +
 * component stack are collapsed behind a `<details>` only while developing. The
 * prop exists so a test can pin BOTH halves of that contract without a build flag.
 *
 * ## Two ways out, deliberately different
 *
 *   • **Qayta urinish** clears the caught error and re-renders the same children.
 *     Cheap, keeps the session, and is enough for anything transient (a race, one
 *     bad response that a refetch replaces).
 *   • **Bosh sahifaga** is a real `<a href="/">`, i.e. a full document load. It is
 *     the guaranteed recovery: it works even when the crash is in state this
 *     boundary cannot clear, and it is the only thing that can help when the ROOT
 *     boundary is the one showing (there is nothing above it left to reset).
 *
 * ## Reporting
 *
 * `console.error` and the optional `onError` callback, and nothing else. No
 * network call: shipping crash reports to a third party is the owner's decision to
 * make, not a side effect of adding a boundary. When Sentry lands it hangs off
 * `onError`.
 *
 * ## Router-free on purpose
 *
 * This is a `shared/ui` primitive, so it knows nothing about react-router: the home
 * action is an anchor and the "a navigation should clear the error" rule is
 * expressed as the {@link ErrorBoundaryProps.resetKey} prop, which `App` feeds from
 * the current pathname. That keeps the design system importable from anywhere.
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { Mascot } from "../Mascot/Mascot";
import { Text } from "../Text/Text";
import styles from "./ErrorBoundary.module.css";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Clears a caught error whenever this value changes (compared with `Object.is`).
   * `App` passes the current pathname, which is what makes a crashed page a crashed
   * PAGE: navigate anywhere and the next screen renders normally instead of
   * inheriting the previous one's fallback.
   */
  resetKey?: unknown;
  /**
   * Reveal the error message + component stack. Defaults to `import.meta.env.DEV`
   * — see the file header for why production never shows them.
   */
  showDetails?: boolean;
  /** Runs after the error is logged. The seam a crash reporter will hang off. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** React's own component stack ("in Foo (at Bar.tsx:3)"), dev display only. */
  componentStack: string | null;
}

function ErrorFallback({
  error,
  componentStack,
  showDetails,
  onRetry,
}: {
  error: Error;
  componentStack: string | null;
  showDetails: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();

  return (
    // `role="alert"` so a screen reader is told the screen was replaced — the
    // visual change is total and a silent swap is exactly as confusing blind.
    <div className={styles.shell} role="alert">
      <Card variant="raised" padding="lg" className={styles.card}>
        {/* Decorative: the heading below already says what happened. */}
        <Mascot mood="sleepy" size={72} label="" />
        <Text as="h1" variant="title-m">
          {t("errors.crashTitle")}
        </Text>
        <Text as="p" variant="body-l" color="ink-soft">
          {t("errors.crashBody")}
        </Text>
        <div className={styles.actions}>
          <Button variant="primary" size="lg" onClick={onRetry}>
            {t("common.retry")}
          </Button>
          <Button variant="secondary" size="lg" asChild>
            <a href="/">{t("errors.crashHome")}</a>
          </Button>
        </div>
        {showDetails && (
          <details className={styles.details}>
            <summary className={styles.summary}>{t("errors.crashDetails")}</summary>
            <pre className={styles.stack}>
              {error.message}
              {componentStack}
            </pre>
          </details>
        )}
      </Card>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Render the fallback on the SAME commit as the throw, so the broken subtree is
    // never painted half-mounted.
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only report, on purpose (see the file header). Logged with the component
    // stack because "which screen" is the one thing the message never says.
    console.error("[ErrorBoundary] uncaught render error", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && !Object.is(prev.resetKey, this.props.resetKey)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error === null) return this.props.children;

    return (
      <ErrorFallback
        error={error}
        componentStack={componentStack}
        showDetails={this.props.showDetails ?? import.meta.env.DEV}
        onRetry={this.reset}
      />
    );
  }
}
