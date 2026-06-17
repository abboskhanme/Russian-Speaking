import React from "react";

type State = { hasError: boolean };

/** Catches render-time crashes so one broken component never blanks the app. */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Unhandled UI error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="col center gap-4"
          style={{ width: "100%", minHeight: "100vh", padding: 24, textAlign: "center", background: "var(--bg)", color: "var(--ink)" }}
        >
          <div style={{ fontSize: 56 }}>😿</div>
          <h1 style={{ fontSize: 22 }}>Что-то пошло не так / Nimadir xato ketdi</h1>
          <p style={{ fontSize: 14, color: "var(--muted)" }}>
            Попробуйте обновить страницу / Sahifani yangilab ko'ring
          </p>
          <button
            onClick={() => window.location.reload()}
            className="tap"
            style={{
              padding: "11px 22px",
              borderRadius: "var(--r-pill)",
              border: "none",
              background: "var(--primary)",
              color: "#fff",
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 15,
              boxShadow: "var(--sh-primary)",
              cursor: "pointer",
            }}
          >
            Обновить / Yangilash
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
