/**
 * widgets — app-shell + navigation layer (FSD `widgets`), composed on top of
 * `shared/ui` + `shared/styles/tokens.css`. Mostly presentational and
 * prop-driven: nav model, active key, callbacks and slots are passed in. Import
 * `shared/styles/tokens.css` + `fonts.css` once at the app root so the
 * `var(--…)` references resolve.
 *
 *   AppShell           — responsive frame (sidebar / top bar / bottom bar / xl rail).
 *   Nav                — the 5 student items with icons, active state, a11y.
 *   ThemeToggle        — flips :root[data-theme] (light/dark) + localStorage (§3.10).
 *                        No longer in the app-shell header (theme moved to
 *                        Profil → Sozlamalar); still used by the pre-login
 *                        auth screens, where Sozlamalar is out of reach.
 *   NotificationsBell  — the app-shell `headerEnd` button + its full-window centre.
 *   Brand              — govorim logo mark + wordmark.
 *
 * ThemeToggle and NotificationsBell are the two SELF-MANAGING widgets here: they
 * own their own state (localStorage / the unread count) rather than taking it as
 * props, because they render in every screen's header and threading that through
 * each screen would be noise.
 */
export * from "./AppShell";
export * from "./Nav";
export * from "./ThemeToggle";
export * from "./Notifications";
export * from "./Brand";
export * from "./Page";
export * from "./Account";
