import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import DOMPurify from "dompurify";
import { useI18n } from "../lib/i18n";

/* ============================================================
   Rich-text editor + renderer for question prompts.
   A dependency-light Word-style editor built on a contentEditable
   surface + execCommand, plus a sanitised renderer so the exact
   formatting a teacher authors is what students see. All HTML —
   stored, pasted, or rendered — passes through DOMPurify, so only
   the formatting tags below survive (no scripts, no event handlers).
   ============================================================ */

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "strike",
    "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "font",
  ],
  ALLOWED_ATTR: ["style", "color", "size", "face", "href", "target", "rel", "type", "start"],
  // No custom ALLOWED_URI_REGEXP: DOMPurify's default already blocks
  // javascript:/data: URIs, and setting a custom one here has the side effect
  // of dropping non-URI attributes like <ol type> and <font size>.
};

/** Clean any HTML down to the whitelisted formatting tags. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html ?? "", SANITIZE_CONFIG) as unknown as string;
}

const hasTags = (s: string) => /<[a-z][\s\S]*>/i.test(s);

/** Plain-text view of rich content — for list/table previews and search. */
export function stripHtml(html: string): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return html; // already plain
  // Turn block/line boundaries into spaces so adjacent words don't run
  // together (e.g. "<h2>Title</h2><p>Body</p>" → "Title Body", not "TitleBody").
  const spaced = html.replace(/<\/(p|div|li|h[1-6]|blockquote|ul|ol)>|<br\s*\/?>/gi, " ");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** True when the content has no visible text (ignoring stray tags). */
export function isEmptyRich(html: string): boolean {
  return stripHtml(html).length === 0;
}

/* ---------------- Renderer ---------------- */
/**
 * Render stored prompt content with its formatting intact. Legacy prompts are
 * plain text (no tags) — those render with preserved line breaks so nothing
 * regresses; new prompts render their sanitised HTML.
 */
export function RichText({
  html,
  style,
  className,
}: {
  html: string | null | undefined;
  style?: CSSProperties;
  className?: string;
}) {
  const value = html ?? "";
  if (!value) return null;
  if (!hasTags(value)) {
    return (
      <div className={`rich-content ${className ?? ""}`} style={{ whiteSpace: "pre-wrap", ...style }}>
        {value}
      </div>
    );
  }
  return (
    <div
      className={`rich-content ${className ?? ""}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
    />
  );
}

/* ---------------- Editor ---------------- */
const TEXT_COLORS = [
  "#1b1b2e", "#6b6b80", "#e8590c", "#d6336c", "#7048e8",
  "#1971c2", "#0c8599", "#2f9e44", "#f08c00", "#e03131",
];
const HILITE_COLORS = ["#fff3bf", "#ffe3e3", "#d3f9d8", "#d0ebff", "#f3d9fa", "#ffec99"];

type Active = Record<string, boolean>;

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 220,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // Last caret/selection that lived INSIDE the editor. A <select> in the toolbar
  // steals focus and collapses the editor selection when opened, so execCommand
  // would have nothing to act on (formatting silently fails and the caret is
  // lost → "can't type"). We remember the range and restore it before every
  // command. Toolbar <button>s don't need this — they preventDefault on
  // mousedown, keeping the selection alive.
  const savedRange = useRef<Range | null>(null);
  const [active, setActive] = useState<Active>({});
  // Current block format at the caret ("p" | "h1" | "h2" | "h3"). Drives the
  // Format dropdown so it reflects — and defaults to Paragraph rather than a
  // forced placeholder.
  const [blockFmt, setBlockFmt] = useState("p");
  const [colorOpen, setColorOpen] = useState(false);
  const [hiliteOpen, setHiliteOpen] = useState(false);
  const [empty, setEmpty] = useState(isEmptyRich(value));

  // Seed/refresh the DOM from `value`, but never while the user is typing
  // (that would fight the caret). External resets — e.g. the edit form loading
  // its question asynchronously — land here because the editor isn't focused.
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const next = value || "";
    if (el.innerHTML !== next) el.innerHTML = sanitizeHtml(next);
    setEmpty(isEmptyRich(next));
  }, [value]);

  const emit = useCallback(() => {
    const html = ref.current?.innerHTML ?? "";
    setEmpty(isEmptyRich(html));
    onChange(html);
  }, [onChange]);

  // Remember the current selection while it's inside the editor.
  const saveSelection = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (el && sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (el.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
    }
  }, []);

  // Put focus + the last in-editor selection back before running a command.
  const restoreSelection = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const r = savedRange.current;
    if (sel && r && el.contains(r.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }, []);

  const refreshActive = useCallback(() => {
    const el = ref.current;
    if (!el || document.activeElement !== el) return;
    saveSelection();
    const q = (c: string) => {
      try { return document.queryCommandState(c); } catch { return false; }
    };
    setActive({
      bold: q("bold"), italic: q("italic"), underline: q("underline"),
      strike: q("strikeThrough"), ul: q("insertUnorderedList"), ol: q("insertOrderedList"),
      left: q("justifyLeft"), center: q("justifyCenter"), right: q("justifyRight"),
    });
    // Reflect the caret's block in the Format dropdown. queryCommandValue
    // returns the tag (h1/h2/h3/p/blockquote/…); anything that isn't a heading
    // falls back to Paragraph so the control always has a valid default value.
    let fmt = "p";
    try {
      const v = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
      if (v === "h1" || v === "h2" || v === "h3") fmt = v;
    } catch { /* noop */ }
    setBlockFmt(fmt);
  }, [saveSelection]);

  useEffect(() => {
    const handler = () => refreshActive();
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, [refreshActive]);

  // execCommand with CSS output (so we get <span style> not legacy <font>).
  const exec = (cmd: string, arg?: string) => {
    restoreSelection();
    try { document.execCommand("styleWithCSS", false, "true"); } catch { /* noop */ }
    const ok = document.execCommand(cmd, false, arg);
    if (!ok && cmd === "hiliteColor") document.execCommand("backColor", false, arg);
    emit();
    refreshActive();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const clean = html
      ? sanitizeHtml(html)
      : text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
    document.execCommand("insertHTML", false, clean);
    emit();
  };

  const setBlock = (tag: string) => exec("formatBlock", tag);

  // Nearest ancestor element of `tag` between the caret and the editor root.
  const closest = (tag: string): HTMLElement | null => {
    let node: Node | null = window.getSelection()?.anchorNode ?? null;
    while (node && node !== ref.current) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === tag) return node as HTMLElement;
      node = node.parentNode;
    }
    return null;
  };

  // Lists: bullet, or an ordered list whose marker (1 / a / A / i) is stored as
  // list-style-type on the <ol> so the exact choice round-trips through save.
  const setList = (kind: string) => {
    restoreSelection();
    const state = (c: string) => { try { return document.queryCommandState(c); } catch { return false; } };
    if (kind === "none") {
      if (state("insertUnorderedList")) document.execCommand("insertUnorderedList");
      if (state("insertOrderedList")) document.execCommand("insertOrderedList");
    } else if (kind === "bullet") {
      if (state("insertOrderedList")) document.execCommand("insertOrderedList");
      if (!state("insertUnorderedList")) document.execCommand("insertUnorderedList");
    } else {
      if (state("insertUnorderedList")) document.execCommand("insertUnorderedList");
      if (!state("insertOrderedList")) document.execCommand("insertOrderedList");
      const ol = closest("OL");
      if (ol) {
        // Store the marker two ways so it always survives sanitisation: the
        // modern CSS property and the native <ol type> attribute as a fallback.
        ol.style.listStyleType = kind; // decimal | lower-alpha | upper-alpha | lower-roman
        const typeAttr: Record<string, string> = {
          decimal: "1", "lower-alpha": "a", "upper-alpha": "A", "lower-roman": "i",
        };
        if (typeAttr[kind]) ol.setAttribute("type", typeAttr[kind]);
      }
    }
    emit();
    refreshActive();
  };

  return (
    <div className="rte-wrap">
      {/* Toolbar */}
      <div className="rte-toolbar">
        {/* Stateful block-format control: shows the caret's current block and
            defaults to Paragraph — a real, reselectable value, not a forced
            placeholder. Picking an item applies it; `blockFmt` (kept in sync by
            refreshActive) then displays what was chosen. */}
        <select
          className="rte-select"
          title={t("rteFormat")}
          value={blockFmt}
          onChange={(e) => setBlock(e.target.value)}
        >
          <option value="p">{t("rteParagraph")}</option>
          <option value="h1">{t("rteHeading")} 1</option>
          <option value="h2">{t("rteHeading")} 2</option>
          <option value="h3">{t("rteHeading")} 3</option>
        </select>

        <select
          className="rte-select"
          title={t("rteSize")}
          value=""
          onChange={(e) => { const v = e.target.value; e.target.value = ""; exec("fontSize", v); }}
        >
          <option value="" disabled hidden>{t("rteSize")}</option>
          <option value="2">{t("rteSmall")}</option>
          <option value="3">{t("rteNormal")}</option>
          <option value="5">{t("rteLarge")}</option>
          <option value="7">{t("rteHuge")}</option>
        </select>

        <span className="rte-sep" />

        <Btn label="B" title={t("rteBold")} active={active.bold} bold onPress={() => exec("bold")} />
        <Btn label="I" title={t("rteItalic")} active={active.italic} italic onPress={() => exec("italic")} />
        <Btn label="U" title={t("rteUnderline")} active={active.underline} underline onPress={() => exec("underline")} />
        <Btn label="S" title={t("rteStrike")} active={active.strike} strike onPress={() => exec("strikeThrough")} />

        <span className="rte-sep" />

        {/* Text colour */}
        <div className="rte-pop-wrap">
          <Btn label="A" title={t("rteColor")} underlineColor="#e8590c" onPress={() => { setColorOpen((v) => !v); setHiliteOpen(false); }} />
          {colorOpen && (
            <Palette
              colors={TEXT_COLORS}
              onPick={(c) => { exec("foreColor", c); setColorOpen(false); }}
              onClose={() => setColorOpen(false)}
            />
          )}
        </div>
        {/* Highlight */}
        <div className="rte-pop-wrap">
          <Btn label="✎" title={t("rteHighlight")} onPress={() => { setHiliteOpen((v) => !v); setColorOpen(false); }} />
          {hiliteOpen && (
            <Palette
              colors={HILITE_COLORS}
              onPick={(c) => { exec("hiliteColor", c); setHiliteOpen(false); }}
              onClose={() => setHiliteOpen(false)}
            />
          )}
        </div>

        <span className="rte-sep" />

        <select
          className="rte-select"
          title={t("rteList")}
          value=""
          onChange={(e) => { const v = e.target.value; e.target.value = ""; setList(v); }}
        >
          <option value="" disabled hidden>{t("rteList")}</option>
          <option value="none">{t("rteListNone")}</option>
          <option value="bullet">•&nbsp;&nbsp;—</option>
          <option value="decimal">1, 2, 3</option>
          <option value="lower-alpha">a, b, c</option>
          <option value="upper-alpha">A, B, C</option>
          <option value="lower-roman">i, ii, iii</option>
        </select>
        <Btn label="❝" title={t("rteQuote")} onPress={() => setBlock("blockquote")} />

        <span className="rte-sep" />

        <Btn label="⯇" title={t("rteAlignLeft")} active={active.left} onPress={() => exec("justifyLeft")} />
        <Btn label="≡" title={t("rteAlignCenter")} active={active.center} onPress={() => exec("justifyCenter")} />
        <Btn label="⯈" title={t("rteAlignRight")} active={active.right} onPress={() => exec("justifyRight")} />

        <span className="rte-sep" />

        <Btn label="⌫" title={t("rteClear")} onPress={() => exec("removeFormat")} />
        <Btn label="↶" title={t("rteUndo")} onPress={() => exec("undo")} />
        <Btn label="↷" title={t("rteRedo")} onPress={() => exec("redo")} />
      </div>

      {/* Editable surface */}
      <div className="rte-surface-wrap">
        {empty && placeholder && <div className="rte-placeholder">{placeholder}</div>}
        <div
          ref={ref}
          className="rte-surface rich-content"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          style={{ minHeight }}
          onInput={() => { emit(); refreshActive(); }}
          onPaste={onPaste}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onBlur={emit}
        />
      </div>
    </div>
  );
}

/* A toolbar button. onMouseDown + preventDefault keeps the editor selection
   alive when the button is clicked (otherwise execCommand has nothing to act on). */
function Btn({
  label, title, onPress, active, bold, italic, underline, strike, underlineColor,
}: {
  label: string;
  title: string;
  onPress: () => void;
  active?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  underlineColor?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="rte-btn"
      data-active={active ? "true" : "false"}
      onMouseDown={(e) => { e.preventDefault(); onPress(); }}
      style={{
        fontWeight: bold ? 900 : 800,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : strike ? "line-through" : "none",
        textDecorationColor: underlineColor,
      }}
    >
      {label}
    </button>
  );
}

/* Colour-swatch popover for text colour / highlight. */
function Palette({
  colors, onPick, onClose,
}: {
  colors: string[];
  onPick: (c: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div onMouseDown={(e) => { e.preventDefault(); onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
      <div className="rte-palette anim-fade-up">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className="rte-swatch tap"
            title={c}
            onMouseDown={(e) => { e.preventDefault(); onPick(c); }}
            style={{ background: c }}
          />
        ))}
      </div>
    </>
  );
}
