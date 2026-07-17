# `shared/ui` — Ovoz Design System (plan)

> This is a **plan doc only** — no component code yet. It records what the DS
> layer will contain and the rules every component follows. Authoritative spec:
> [`docs/03-DESIGN-SYSTEM.md`](../../../../docs/03-DESIGN-SYSTEM.md) §3.6.

`shared/ui` is the **single** design system. When migration finishes, the two
legacy rival systems — `ui.tsx` and `govori.tsx` (and the violet `@theme`
block) — are **deleted** (docs/03 §3.11 step 9, docs/07 §7.11).

## Foundation (already landed this sprint)

- `shared/styles/tokens.css` — every color / type / space / radius / shadow / z /
  motion value, light + dark. **Source of truth.**
- `shared/styles/fonts.css` (+ `fonts/`) — self-hosted Onest + JetBrains Mono.

## Tech stack

- **React + TypeScript**, built with **Radix UI primitives** for anything with
  interaction/a11y semantics (Dialog, DropdownMenu, Tabs, Tooltip, Popover,
  Checkbox, Radio, Slider, Toggle) — correct `role`, `aria-*`, focus trap for
  free. Replaces the hand-rolled, a11y-less dropdowns in today's `App.tsx`.
- **Tokens only** — components consume `var(--…)` from `tokens.css`. Never a raw
  `#hex` / `rgb()`, and no `style={{ color: … }}` except genuinely dynamic
  geometry (waveform bar heights, progress %). (docs/03 §3.10, CI-linted.)
- **Variants with CVA** (`class-variance-authority`) via `className`, not boolean
  props. (docs/03 §3.6.)
- **Storybook** — every component ships a story; visual + a11y (`axe`) checks run
  there and in CI (docs/03 §3.9).

## Per-component file layout (docs/03 §3.6)

```
shared/ui/<Component>/
  <Component>.tsx          implementation (tokens + CVA + Radix)
  <Component>.stories.tsx  Storybook (all variants × states)
  <Component>.test.tsx     unit / a11y
```

## FSD placement rules

- `shared/ui` = **generic, domain-agnostic** primitives only. It must not import
  from `entities/`, `features/`, `widgets/`, `pages/`, or `app/` (FSD one-way
  dependency rule). Domain widgets (ScoreCard, ClassInsightBoard, …) live in
  `widgets/` and *compose* these primitives.
- No import from `ui.tsx` / `govori.tsx` (they are being removed).
- Full-width rule holds: primitives never impose `mx-auto max-w-*`; breathing
  room comes from inner grid columns, not the page root (docs/03 §3.8).

## Component inventory (docs/03 §3.6)

**Foundations** — `Icon` (24×24 grid, 1.75px stroke, ~40 icons) · `Text` ·
`Stack` / `Row` / `Col` · `Spacer` · `VisuallyHidden`

**Actions** — `Button` (`primary · secondary · ghost · danger · success` ×
`sm · md · lg`; states: hover, active `scale(.96)`, focus-visible, loading,
disabled) · `IconButton` (ghost/solid + tooltip) · `Fab` (mobile "Gapirish") ·
`SegmentedControl` · `Toggle`

**Containment** — `Card` (`flat · raised · outline · tint`) · `Sheet` (mobile
full-height) · `Dialog` (Radix) · `Popover` · `DropdownMenu` (Radix) · `Tooltip`
· `Accordion` · `Tabs`

**Forms** — `Input` · `Textarea` · `Select` · `Checkbox` · `Radio` · `Slider` ·
`PhoneInput` (+998 mask) · `RichTextEditor` (existing, adapted) · `FileDrop` ·
`FormField` (label + hint + error + a11y wiring)

**Feedback** — `Skeleton` · `Spinner` · `ProgressBar` · `Toast` · `EmptyState`
(with Govo) · `ErrorState` · `Paywall` · `Confetti`

**Data** — `Stat` · `StatTile` · `DataTable` (sticky header, mobile → cards) ·
`Sparkline` · `LineChart` · `BarChart` · `RadarChart` · `Ring` · `Bar` · `Badge`
· `Pill` · `Avatar` · `AvatarGroup` · `Pagination`

**Domain-specific — the heart of the product** (docs/03 §3.6):

| Component | Note |
|---|---|
| **`Mascot`** (Govo) | 5 moods — `idle · listening · thinking · proud · sleepy`. Mouth = live waveform. Never sad/crying. 3 primitives (squircle, circle, capsule), 3px @96px stroke. |
| **`Recorder`** | Mic button + live waveform (canvas) + timer + prep countdown. **Govo's mouth lives here.** |
| **`Waveform`** | Live (`AnalyserNode`) and static (recorded audio) modes. |
| **`ScoreReveal`** | Ring + count-up + 4 criterion bars + confetti (≥70). Uses `--m-spring` — the only place. |
| **`CriterionRow`** | Criterion + score + "how to improve" button (a number is never alone). |
| **`WordTranscript`** | Per-word color + underline style + tap → phoneme breakdown + hear-word (TTS). Color is never the only signal. |
| **`CorrectionCard`** | `original → corrected` diff, type tag, one-line note. Max 3 shown. |
| **`PhonemeChip`** | `[ɕː]` + accuracy. |
| **`MinimalPairDrill`** | ы/и discrimination drill. |
| **`StreakFlame`** | Flame + freeze state. Lost = grey, never red. |
| **`AchievementCard`** | Unlocked / locked. |
| **`ModuleCard`** | Cover + progress + lock (freemium). |
| **`AttemptRow`** | Date + score + status + trend arrow. |
| **`ClassInsightCard`** | e.g. "12 students stumbled on *родительный падеж* → assign remediation". |
| **`RoleplayBubble`** | Conversation turn (AI / student), audio play + transcript. |

## Build order (docs/03 §3.11)

1. `Recorder` + `Waveform` + `Mascot` — the core interaction; the brand "feel"
   is born here.
2. `ScoreReveal` / `AttemptResult`.
3. `StudentHome`. … then answer flow, shadowing/progress/leaderboard, auth,
   teacher (compact density), admin.
