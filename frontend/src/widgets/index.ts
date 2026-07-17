/**
 * widgets — app-shell + navigation layer (FSD `widgets`), composed on top of
 * `shared/ui` + `shared/styles/tokens.css`. Presentational and prop-driven:
 * nav model, active key, callbacks and slots are passed in; no routing/data
 * coupling yet. Import `shared/styles/tokens.css` + `fonts.css` once at the app
 * root so the `var(--…)` references resolve.
 *
 *   AppShell    — responsive frame (sidebar / top bar / bottom bar / xl rail).
 *   Nav         — the 5 student items with icons, active state, a11y.
 *   ThemeToggle — flips :root[data-theme] (light/dark) + localStorage (§3.10).
 *   Brand       — govorim logo mark + wordmark.
 */
export * from "./AppShell";
export * from "./Nav";
export * from "./ThemeToggle";
export * from "./Brand";
