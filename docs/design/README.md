# Design — mockups and verification screenshots

Moved here from a top-level `RussianDesign/` (Faza 7.8). Same files, same role;
only the path changed, and every reference in the source was updated with it.

## `mockups/`

The design the UI is built from — **the source of truth for layout, colour,
spacing and copy**, ahead of any screen already in `frontend/src`. Three panels,
one file each:

| File | Panel |
| --- | --- |
| `Govorim - Student.dc.html` | Student app (Home · Practice · Suhbat · Progress · Profile) |
| `Govorim - Teacher.dc.html` | Teacher panel (Bosh · Klasslar · Navbat · Kontent · Analitika) |
| `Govorim - Admin.dc.html` | Admin panel (Boshqaruv · O'qituvchilar · O'quvchilar · Sozlamalar) |
| `Govo.dc.html`, `StatusBar.dc.html`, `support.js` | Shared frames and the export's own runtime |

They are single-file HTML exports: open one in a browser and it renders every
frame. `frontend/src/shared/styles/tokens.css` was derived from the student
file's computed `:root`, which is why the token names read the way they do.

Two standing rules, both learned the hard way and recorded where they bite:

- **The mockups load Onest + JetBrains Mono from a CDN. The app must not** — the
  fonts are self-hosted (`shared/styles/fonts.css`), because a CDN that is slow
  or blocked from Uzbekistan would cost the app its typography.
- **A card in a mockup is not a promise of data.** Where nothing backs one, it is
  left out and recorded as a follow-up rather than filled with an invented
  number — see the "Omitted for want of data" notes in `TEACHER-PANEL-PLAN.md`.

## `screenshots/`

Browser-verification captures kept from the panel builds — the evidence behind
"verified in a browser" in the commit messages (mobile + desktop, light + dark).
They are a RECORD, not a reference: when a screen changes, the screenshot goes
stale and the mockup is still the thing to build against.
