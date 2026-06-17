import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useI18n } from "../lib/i18n";
import { GOOGLE_CLIENT_ID } from "../lib/plan";

/* Minimal typing for the Google Identity Services global. */
interface GsiId {
  initialize: (cfg: { client_id: string; callback: (r: { credential: string }) => void }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
}
function gsi(): GsiId | undefined {
  return (window as unknown as { google?: { accounts?: { id?: GsiId } } }).google?.accounts?.id;
}

/** Official Google Sign-In button. Renders nothing if no client id is configured. */
export function GoogleSignIn() {
  const { loginWithGoogle } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    function init() {
      const id = gsi();
      if (!id || !ref.current) return;
      id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          try {
            await loginWithGoogle(resp.credential);
            nav("/");
          } catch {
            setErr(t("googleError"));
          }
        },
      });
      // Fit the button to its container (GSI needs a number, ~200–400px).
      const cw = ref.current.parentElement?.offsetWidth || 300;
      id.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: Math.min(380, Math.max(220, cw)),
      });
    }

    if (gsi()) {
      init();
      return;
    }
    const existing = document.getElementById("gsi-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", init);
      return () => existing.removeEventListener("load", init);
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.id = "gsi-script";
    s.onload = () => {
      if (!cancelled) init();
    };
    document.body.appendChild(s);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} className="flex justify-center" />
      {err && <p className="text-[13px] font-bold text-danger">{err}</p>}
    </div>
  );
}
