import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./govori";

export interface DropdownOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: DropdownOption<T>[];
  placeholder?: string;
  className?: string;
}

/** Smooth Govori-style custom select (popover menu with checkmark + animation). */
export function Dropdown<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          background: "var(--surface)",
          border: `1px solid ${open ? "var(--primary)" : "var(--line-2)"}`,
          borderRadius: "var(--r-pill)",
          padding: "10px 16px",
          fontSize: 15,
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          color: "var(--ink)",
          cursor: "pointer",
          transition: "border-color .15s, transform .12s",
        }}
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.99)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selected ? "var(--ink)" : "var(--faint)",
          }}
        >
          {selected?.label ?? placeholder}
        </span>
        <Icon
          name="chevD"
          size={16}
          style={{
            flexShrink: 0,
            color: open ? "var(--primary)" : "var(--muted)",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform .2s",
          }}
        />
      </button>

      <div
        style={{
          position: "absolute",
          left: 0,
          zIndex: 30,
          marginTop: 8,
          minWidth: "100%",
          transformOrigin: "top",
          overflow: "hidden",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
          boxShadow: "var(--sh-lg)",
          transition: "transform .15s ease-out, opacity .15s ease-out",
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0) scale(1)" : "translateY(-4px) scale(0.95)",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div style={{ maxHeight: 288, overflowY: "auto", padding: "4px 0" }}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  whiteSpace: "nowrap",
                  padding: "10px 16px",
                  textAlign: "left",
                  fontSize: 15,
                  fontFamily: "var(--font-display)",
                  fontWeight: active ? 800 : 700,
                  color: active ? "var(--primary-press)" : "var(--ink)",
                  background: active ? "var(--primary-tint)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  transition: "background .12s",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "var(--surface-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = active
                    ? "var(--primary-tint)"
                    : "transparent";
                }}
              >
                <span>{o.label}</span>
                {active && (
                  <Icon
                    name="check"
                    size={16}
                    style={{ flexShrink: 0, color: "var(--primary-press)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
