/**
 * Copy text to the clipboard, with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is **undefined outside a secure context** — HTTPS or
 * `localhost`. The teacher panel is regularly opened over plain HTTP on a LAN
 * address (`http://192.168.x.x:8081`) while testing on a phone, and the invite
 * screen's whole job is handing over a link and a join code. So the modern API
 * alone would fail exactly where copying matters most.
 *
 * Falls back to a hidden textarea + the deprecated `document.execCommand("copy")`,
 * which still works in every current browser and does not need a secure context.
 *
 * @returns whether the copy actually succeeded — callers should surface a
 * "copied" confirmation only on `true`, and leave the value selectable otherwise.
 */
export async function copyText(text: string): Promise<boolean> {
  // Preferred path: the async Clipboard API (secure contexts only).
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* Permission denied or not focused — fall through to the legacy path. */
    }
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Keep it out of sight AND out of the layout, but still focusable: a
    // `display:none` or `hidden` element cannot be selected, so the copy fails.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS needs the explicit range
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
