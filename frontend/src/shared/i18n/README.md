# shared/i18n — internationalization (Faza 4.7)

`i18next` + `react-i18next`, bootstrapped in [`index.ts`](./index.ts) and imported
once at the app root (`src/main.tsx`) before React renders.

## Contract

| Setting | Value | Why |
| --- | --- | --- |
| Languages | `uz` · `ru` · `en` | docs/08 §4.7 |
| Default language | `uz` | Product default (govorim.uz audience) |
| Fallback language | `uz` | A missing key never shows a raw id |
| Language detection | **OFF** | The language is an explicit, app-owned choice — persisted server-side per user in the real product. Nothing sniffs `navigator`. |
| Namespaces | `common` (this pass) | Split per surface as keys are ported (see below) |
| Plurals | i18next built-in CLDR (`Intl.PluralRules`) | Russian one/few/many for free — `t("units.points", { count: 2 })` → «2 балла» (the §4.7 DoD). No `i18next-icu` required. |

Resources are **statically bundled JSON** (`src/locales/{uz,ru,en}/common.json`),
so `init()` is synchronous and `useTranslation()` works on first render (no
Suspense boundary needed).

### Usage

```tsx
import { useTranslation } from "react-i18next";

function ChatCta() {
  const { t } = useTranslation();          // defaultNS = "common"
  return <button>{t("common.back")}</button>;
}
```

Change language explicitly:

```ts
import { setLang } from "@/shared/i18n";
setLang("ru");
```

## Starter keys wired this pass

`common.json` carries a representative slice — **not** the full catalogue yet:

- `app.*` — product name / tagline.
- `nav.*` — the 5 student destinations (`home` · `practice` · `chat` · `progress` · `profile`). Proven live in the AI Chat screen, whose `Nav` labels are rendered through `t("nav.<key>")`.
- `common.*` — shared buttons (`continue`, `start`, `back`, `next`, `retry`, `skip`, `save`, `cancel`, `close`, `loading`).
- `theme.*` — light/dark toggle labels.
- `chat.*` — the "AI Suhbat — tez orada" placeholder screen.
- `units.points` — the plural sample (one/few/many) that exercises the Russian CLDR rule end-to-end.

## Full-extraction plan (the remaining ~2085 keys)

The legacy strings live in `src/lib/i18n.tsx` (the pre-rewrite dictionary) and,
inline, across `src/pages/**` + `src/components/**`. Porting them:

1. **Extract** the legacy `uz`/`ru`/`en` dictionaries from `lib/i18n.tsx` into
   JSON, then sweep `pages/**` + `components/**` for inline literals (a
   `i18next-parser` run over the new `screens/**` catches `t()` calls; hardcoded
   Uzbek in the screens is migrated key-by-key).
2. **Split namespaces by surface** so each lazy route only ships its own strings
   (keeps the initial JS budget of §4.1 — ≤180 KB gz):
   - `common` — nav, buttons, generic labels (loaded eagerly).
   - `home`, `practice`, `chat`, `progress`, `profile` — per-screen (lazy).
   - `teacher`, `admin` — role areas (Faza 4.9 / 4.10, lazy).
   - `errors`, `auth`, `grading` — cross-cutting.
   Register them in `resources` (or switch to `i18next-http-backend` /
   per-namespace dynamic `import()` if the bundle grows).
3. **Plurals** — anywhere the legacy code hand-picked a Russian form, replace it
   with `t(key, { count })` + `key_one` / `key_few` / `key_many` entries. Add
   `i18next-icu` only if a string needs full ICU (select/ordinals/nested);
   cardinal plurals do **not** need it.
4. **Screen migration** — the `screens/**` currently hardcode Uzbek copy. Move
   each literal to its namespace and swap in `t()`. `nav`/`common` already flow
   through `t()` here to prove the pipeline.
5. **CI guard** — fail the build on missing keys in any language
   (`i18next-parser --fail-on-warnings`), so `uz`/`ru`/`en` stay in lockstep.

## Known follow-up (for the architect)

`widgets/Nav/navItems.tsx` ships **hardcoded** Uzbek `label`s. The AI Chat screen
works around this by re-labelling `studentNavItems` through `t()` locally. To make
every screen's nav translatable, either turn `studentNavItems` into a factory
(`studentNavItems(t)`) or have each screen accept translated nav items as a prop.
Flagged rather than done here — the widget files are out of scope for this pass.
