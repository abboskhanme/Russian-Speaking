import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../lib/i18n";
import { Button } from "./govori";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

interface State {
  options: ConfirmOptions;
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setState({ options, resolve })),
    [],
  );

  function close(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <Dialog
          options={state.options}
          onCancel={() => close(false)}
          onConfirm={() => close(true)}
        />
      )}
    </Ctx.Provider>
  );
}

function Dialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Trigger the enter animation after mount.
    const id = requestAnimationFrame(() => setShown(true));
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [onCancel, onConfirm]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        opacity: shown ? 1 : 0,
        transition: "opacity .2s ease-out",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "absolute",
          inset: 0,
          background: "oklch(0.3 0.02 60 / 0.4)",
          backdropFilter: "blur(4px)",
        }}
      />

      {/* Card */}
      <div
        className={shown ? "anim-pop" : undefined}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 340,
          overflow: "hidden",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--sh-lg)",
          padding: 22,
          opacity: shown ? 1 : 0,
          transition: "opacity .2s ease-out",
        }}
      >
        <div style={{ textAlign: "center", paddingTop: 4, paddingBottom: 20 }}>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 18,
              lineHeight: 1.2,
              color: "var(--ink)",
              margin: 0,
            }}
          >
            {options.title ?? t("confirmTitle")}
          </h2>
          <p
            style={{
              marginTop: 6,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              color: "var(--muted)",
            }}
          >
            {options.message}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="ghost" full onClick={onCancel}>
            {options.cancelText ?? t("cancel")}
          </Button>
          <Button
            variant="primary"
            full
            onClick={onConfirm}
            style={
              options.destructive
                ? { background: "var(--danger)", color: "#fff", boxShadow: "none" }
                : undefined
            }
          >
            {options.confirmText ?? t("confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
