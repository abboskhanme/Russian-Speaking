# 06 · Claude Design uchun promptlar

> **Qanday ishlatiladi**
> 1. `claude.ai/design` da yangi **design-system** turidagi loyiha oching (nomi: `Govori · Ovoz DS`).
> 2. Quyidagi **Prompt A** ni to'liq nusxa qiling va yuboring. U poydevor + komponentlarni yaratadi.
> 3. Keyin **Prompt B1…B6** ni birma-bir yuboring (ekranlar).
> 4. **Prompt C** — logo va mascot uchun.
> 5. Natijani kodga qaytarish: Claude Code'da `DesignSync` (yoki `/design-sync` skili) bilan
>    komponentni **birma-bir** sinxronlang — hech qachon "hammasini almashtir" qilmang.
>
> Promptlar **inglizcha** — dizayn generatsiyasi uchun eng barqaror til. Tokenlar
> [`03-DESIGN-SYSTEM.md`](./03-DESIGN-SYSTEM.md) bilan **bir xil**; birini o'zgartirsangiz, ikkinchisini ham o'zgartiring.

---

## Prompt A — Master (poydevor + komponent kutubxonasi)

```text
You are designing the complete design system for **Govori** (govorim.uz) — an AI-powered
platform where Uzbek-speaking students practice SPEAKING Russian out loud. A student records
their voice answering a task, AI transcribes it, scores pronunciation word-by-word, and returns
short, kind feedback in Uzbek. Teachers assign tasks and review borderline answers.

The design system is called **Ovoz** ("voice" in Uzbek).

════════════════════════════════════════════════════════════
1. PERSONALITY — the single most important constraint
════════════════════════════════════════════════════════════
"Cozy, cute-but-not-childish."

The user is a 13–18 year old teenager, or an adult learning Russian for work. They are ANXIOUS
about speaking. The interface must feel like a warm, patient friend — never like a test, never
like a toy.

DO: rounded geometry, one consistent radius family, generous whitespace, a single strong accent
color, calm surfaces, soft warm-tinted shadows, one restrained mascot.

DO NOT: gradient-filled buttons, glassmorphism, 3D emoji, drop shadows on text, neon, comic
fonts, bouncing animations, exclamation marks, red "WRONG!" states, progress bars that shame.

════════════════════════════════════════════════════════════
2. COLOR — OKLCH, light + dark are both first-class
════════════════════════════════════════════════════════════
Brand
  --primary          light oklch(0.665 0.185 40)   dark oklch(0.720 0.170 42)
  --primary-press    light oklch(0.595 0.180 38)   dark oklch(0.660 0.165 40)
  --primary-tint     light oklch(0.945 0.038 48)   dark oklch(0.300 0.055 42)
  --primary-tint-2   light oklch(0.905 0.068 46)   dark oklch(0.360 0.070 42)
  --primary-on       light oklch(0.995 0.004 60)   dark oklch(0.180 0.020 45)
  --accent           light oklch(0.545 0.155 272)  dark oklch(0.680 0.140 272)
  --accent-tint      light oklch(0.945 0.035 272)  dark oklch(0.300 0.055 272)

Surfaces & ink
  --bg         light oklch(0.973 0.010 72)  dark oklch(0.190 0.012 60)
  --surface    light oklch(0.998 0.003 80)  dark oklch(0.235 0.014 60)
  --surface-2  light oklch(0.978 0.008 76)  dark oklch(0.275 0.016 60)
  --surface-3  light oklch(0.958 0.013 74)  dark oklch(0.315 0.018 60)
  --ink        light oklch(0.270 0.024 55)  dark oklch(0.965 0.008 75)
  --ink-soft   light oklch(0.450 0.020 58)  dark oklch(0.830 0.012 72)
  --muted      light oklch(0.600 0.018 62)  dark oklch(0.680 0.014 68)
  --faint      light oklch(0.745 0.014 68)  dark oklch(0.520 0.012 64)
  --line       light oklch(0.910 0.011 72)  dark oklch(0.320 0.014 60)
  --line-2     light oklch(0.862 0.016 70)  dark oklch(0.400 0.016 60)

Semantic (each also has a -tint: light = L 0.945 / chroma÷4, dark = L 0.300 / chroma÷2.5)
  --success  light oklch(0.640 0.140 155)  dark oklch(0.720 0.130 155)
  --warn     light oklch(0.760 0.135 82)   dark oklch(0.800 0.125 82)
  --danger   light oklch(0.605 0.170 20)   dark oklch(0.680 0.160 20)
  --info     light oklch(0.600 0.115 245)  dark oklch(0.700 0.105 245)

Rules
  · The brand color (hue 40) must stay visually distinct from semantic red (hue 20). Keep
    lightness and chroma separated. Never place them adjacent as fills.
  · Exactly ONE primary button per screen.
  · Dark mode background is warm charcoal, never pure black. Shadows weaken in dark; elevation
    is expressed by raising surface lightness one step.

PRONUNCIATION SCALE (per-word feedback — the product's signature)
  good (≥80) → --success  + solid underline
  mid (60–79)→ --warn     + DOTTED underline
  low (<60)  → --danger   + WAVY underline + small ⚠ icon
  neutral    → --muted    + no underline
  ⚠ Color is NEVER the only signal. This is a hard accessibility requirement — deuteranopes
    cannot separate green from amber. Underline style + icon always accompany the color.

════════════════════════════════════════════════════════════
3. TYPE
════════════════════════════════════════════════════════════
Display + UI : "Onest" (400/500/600/700/800). Fallback: Nunito, system-ui.
Mono         : "JetBrains Mono" (400/500) — transcripts, phonemes, timings.
Must support Latin + Cyrillic + Uzbek ʻ.

Scale (name / size / line-height / weight / tracking)
  score      56 / 56 / 800 / -3%    tabular-nums — the big score number
  display    40 / 44 / 800 / -2.5%
  title-l    26 / 32 / 800 / -2%
  title-m    20 / 26 / 700 / -1.5%
  title-s    17 / 24 / 700 / -1%
  body-l     16 / 25 / 500 / 0      task text, transcripts
  body       15 / 22 / 500 / 0      DEFAULT
  body-s    13.5 / 19 / 500 / 0
  label     11.5 / 14 / 800 / +6%   UPPERCASE
  mono      13.5 / 21 / 400 / 0

Rules: max 4 text sizes per screen · all numerals tabular-nums · Russian body text never below
body-l (Cyrillic has a lower x-height).

════════════════════════════════════════════════════════════
4. SPACE · RADIUS · ELEVATION · MOTION
════════════════════════════════════════════════════════════
Space (4px base): 4 8 12 16 20 24 32 40 48 64
Radius: xs 10 · sm 14 · md 18 · lg 24 · xl 32 · pill 999
        Nesting rule: inner_radius = outer_radius − padding.
Elevation (warm-tinted, never cool grey):
  e-1 card · e-2 dropdown · e-3 modal · e-primary (0 6px 18px primary/30%)
Motion:
  instant  90ms ease-out              hover, tint
  fast    140ms cubic-bezier(.2,.7,.3,1)   press, toggle
  base    220ms cubic-bezier(.2,.7,.3,1)   card/page enter
  slow    380ms cubic-bezier(.16,1,.3,1)   modal, sheet
  spring  520ms cubic-bezier(.2,.9,.25,1.15)  SCORE REVEAL ONLY
  Every :active → scale(0.96). Honour prefers-reduced-motion (no confetti, instant count-up).

════════════════════════════════════════════════════════════
5. MASCOT — "Govo"
════════════════════════════════════════════════════════════
A speech-bubble creature: a squircle body with a tail at the lower-left, two dot eyes,
NO MOUTH. Built ONLY from three primitives — squircle, circle, capsule. No arms, no legs.
Stroke weight 3px at 96px, scales proportionally.

★ Core idea: when the student speaks, GOVO'S MOUTH IS THE LIVE WAVEFORM.
  The audio waveform animates inside Govo's body. The mascot and the product's core
  interaction are literally the same object.

Moods (only 5): idle · listening (waveform inside) · thinking (three dots from the tail,
eyes up) · proud (arc "^^" eyes) · sleepy (half-closed eyes).
Govo NEVER frowns, cries, turns red, or points at a mistake.

LOGO: the mark is Govo's squircle bubble containing three ascending vertical bars (a waveform
that also reads as growth). Lockup = mark + lowercase wordmark "govori" in Onest 800, -2%
tracking. Mark must survive at 20px (favicon).

════════════════════════════════════════════════════════════
6. WHAT TO PRODUCE
════════════════════════════════════════════════════════════
Produce ONE self-contained HTML preview file per item below. Every file:
  · starts with  <!-- @dsCard group="<Group>" -->  on line 1
  · is fully self-contained (inline CSS, inline SVG, no external requests)
  · renders BOTH light and dark (use prefers-color-scheme AND :root[data-theme])
  · shows every state, not just the default

Group "Foundations"
  1. colors.html      — full palette, light + dark side by side, with contrast ratios printed
  2. type.html        — the whole scale, in Latin AND Cyrillic (Русский текст)
  3. space-radius.html
  4. elevation.html
  5. motion.html      — live examples of each duration/easing
  6. icons.html       — 40 icons, 24×24 grid, 1.75px stroke: mic, mic-off, play, pause, wave,
                        home, practice, progress, layers, users, message, headphones, trophy,
                        flame, star, check, x, chevron ×4, plus, edit, trash, copy, search,
                        filter, bell, settings, logout, globe, link, send, lock, unlock,
                        clock, calendar, chart, refresh, sparkle, alert

Group "Brand"
  7. logo.html        — mark, lockup, sizes 20/32/96px, on light/dark/primary, clear space
  8. mascot.html      — Govo in all 5 moods + the waveform-mouth in motion

Group "Actions"
  9. button.html      — primary/secondary/ghost/danger/success × sm/md/lg × default,hover,
                        active,focus-visible,loading,disabled
 10. icon-button.html · fab.html · segmented-control.html · toggle.html

Group "Containment"
 11. card.html (flat/raised/outline/tint) · sheet.html · dialog.html · popover.html ·
     dropdown-menu.html · tooltip.html · tabs.html · accordion.html

Group "Forms"
 12. input.html · textarea.html · select.html · checkbox-radio.html · slider.html ·
     phone-input.html (+998 mask) · form-field.html (label + hint + error, showing the
     aria-describedby wiring in a comment)

Group "Feedback"
 13. skeleton.html · spinner.html · progress.html · toast.html · empty-state.html (with Govo
     sleepy) · error-state.html · paywall.html · confetti.html

Group "Data"
 14. stat-tile.html · data-table.html (sticky header; and its MOBILE card form) ·
     sparkline.html · line-chart.html · bar-chart.html · radar-chart.html · ring.html ·
     badge-pill.html · avatar.html · pagination.html

Group "Product"   ← the heart. Spend the most care here.
 15. recorder.html          — idle → prep countdown → recording (live waveform inside Govo) →
                              review (play/re-record/submit). All four states.
 16. score-reveal.html      — ring + count-up 74 + four criterion bars, each with a
                              "How to improve →" action. The absolute band is NOT shown.
 17. word-transcript.html   — a Russian sentence where each word is colored by pronunciation
                              accuracy with the required underline styles; one word expanded
                              into phoneme chips + a "hear it" button
 18. correction-card.html   — "я идти в магазин → я иду в магазин" with a one-sentence
                              explanation in Uzbek; max 3 shown + "Show all (7)"
 19. criterion-row.html     — label · bar · number · improve-action. Never a number alone.
 20. streak-flame.html      — active, frozen, lost (grey — NEVER red, never shaming)
 21. module-card.html · achievement-card.html · attempt-row.html
 22. roleplay-bubble.html   — AI turn and student turn, audio + transcript
 23. class-insight-card.html— "12 students struggled with родительный падеж → Assign remediation"
 24. minimal-pair-drill.html— ы vs и choice exercise

════════════════════════════════════════════════════════════
7. CONTENT RULES (copy inside the components)
════════════════════════════════════════════════════════════
· Interface language: Uzbek (Latin). Learning content: Russian (Cyrillic). Use REAL strings,
  never lorem ipsum. Examples:
    "Erkin gapir."  ·  "Yaxshi bo'ldi. Endi bittasini birga tuzataylik."
    "Тебя легко понять."  ·  "я идти в магазин → я иду в магазин"
· Feedback is SHORT: one sentence, max 12 words.
· Strengths ALWAYS appear before corrections.
· Every score is accompanied by an action, never displayed alone.
· Errors are never punished: no red banners, no "Wrong", no lost-streak shaming.

════════════════════════════════════════════════════════════
8. LAYOUT LAW
════════════════════════════════════════════════════════════
Page roots are ALWAYS full-bleed. Never `margin: 0 auto; max-width: …` on a page root.
Breathing room comes from INNER grid columns, not from centering the page.
Breakpoints: <720 mobile (bottom nav, 3 items + a central "Speak" FAB) · 720–1080 icon rail ·
1080–1440 sidebar 250px · >1440 sidebar + right context panel.

════════════════════════════════════════════════════════════
9. ACCEPTANCE
════════════════════════════════════════════════════════════
A component is done when:
  [ ] all states rendered (default/hover/active/focus-visible/disabled/loading/empty/error)
  [ ] light AND dark both correct
  [ ] text contrast ≥ 4.5:1 (≥3:1 for large text and interactive borders)
  [ ] focus ring: 2.5px --primary, 2px offset, always visible
  [ ] touch targets ≥ 44×44px
  [ ] no hardcoded hex — every color references a token
  [ ] no color-only meaning
  [ ] respects prefers-reduced-motion

Begin with Group "Foundations", then "Brand", then "Product" (yes — Product before the generic
groups, because Product reveals whether the system actually works). Ask me nothing; make
confident choices and show them.
```

---

## Prompt B — Ekranlar (birma-bir yuboring)

> Har biri alohida xabar. `Prompt A` bilan bir suhbatda — tizim eslab qoladi.

### B1 · Natija ekrani (eng muhim)

```text
Design the ATTEMPT RESULT screen using the Ovoz system. Mobile (375px) and desktop (1440px).

This is the product's value moment. A student just spoke Russian and is about to learn how
they did. They are nervous. Design accordingly.

Order on the page — this order is not negotiable:
  1. Score ring, count-up 0→74, then a single gentle confetti burst (score ≥ 70 only).
     Under it: "Uroven A2". The absolute C2 band is NOT shown anywhere.
     Govo, mood=proud, beside the ring.
  2. One sentence summary: «Тебя легко понять.» (≤12 words)
  3. ✅ Strengths — exactly 2, warm phrasing
  4. 🎙 The student's transcript, word-by-word colored + underline styles; a play button for
     their own audio and one for the model answer. One word is tapped open, showing phoneme
     chips and a "hear this word" button.
  5. ✏️ Corrections — 3 visible, "Show all (7)" below
  6. Four criterion rows, each with "How to improve →"
  7. [Try again]  [Next task →]

≥40% of the screen is empty space. This is a message, not a document.
Mobile: primary action sticks to the bottom, above the safe area.
```

### B2 · Yozuv ekrani

```text
Design the RECORD screen: task card (title, CEFR badge, style badge Обычный/Живой, media 16:9,
instruction in a tinted block) → [I'm ready] → 30s preparation countdown ring with Govo idle →
recording state where Govo's body contains the live waveform, a 96px circular stop button, a
timer, and a max-length bar → review state [Listen] [Re-record] [Submit].

The task text stays visible while recording. Show the remaining free attempts as dots (● ● ○).
Nothing here may feel like an exam: no red timer, no ticking.
```

### B3 · Kutish (grading) ekrani

```text
Design the GRADING WAIT screen. Never a bare spinner. Govo, mood=thinking. A staged checklist
that fills in over ~15 seconds:
   ✓ Ovozing eshitildi           1.2s
   ✓ Matnga aylantirildi         4.1s
       «я вчера ходил в магазин и…»   ← the transcript appears here immediately
   ⟳ Talaffuzni tekshiryapman
   ○ Grammatikani ko'ryapman
Make the wait feel like progress, not delay.
```

### B4 · Bosh sahifa (o'quvchi)

```text
Design the student HOME. One dominant card: "Bugungi 5 daqiqa" — Govo, streak flame (12 kun),
three step dots, [Boshlash →]. Below: three quiet stat tiles (level, weekly minutes, streak),
then "Davom etayotgan modul", then the last result as a compact row.
Full-bleed. Mobile: 3-item bottom nav (Bosh · Mashq · Progress) + a central Speak FAB.
Calm. Fewer elements than you think you need.
```

### B5 · Roleplay

```text
Design the ROLEPLAY flow: (a) a scenario grid — 8 cards, each with an illustration slot, CEFR,
duration, and the goal («Дозировку узнать»); (b) the conversation screen — alternating bubbles
(AI vs student), each with play + transcript, a [Yordam] button offering 3 suggested phrases,
and a large record button pinned at the bottom; (c) the debrief — goal achieved?, fluency,
3 useful phrases learned, per-turn pronunciation review, [Yana urinish].
```

### B6 · O'qituvchi paneli

```text
Design the TEACHER OVERVIEW at density=compact. It answers exactly one question:
"Bugun kimga yordam kerak?"

Block 1 "Needs attention": 3 low-AI-confidence answers · 2 students who dropped 15 points in
two weeks · 5 assignments due today (each row = one tap to act).
Block 2 "This week's class mistakes": "родительный падеж — 12 students → [Assign remediation]".

No list of 500 submissions. The system tells the teacher what to do.
Also show the REVIEW QUEUE screen: a queue, not a table — one answer at a time, audio,
transcript, AI score, [Agree] [Override] with a comment field.
```

---

## Prompt C — Brend paketi (logo + mascot, alohida)

```text
Design the Govori brand mark and mascot as production SVGs.

MARK: a squircle speech bubble (superellipse n≈4, not a rounded rect) with a 45° tail at the
lower-left. Inside: three ascending vertical bars with pill caps — a waveform that also reads
as growth. Optical balance over mathematical centering.

Deliver: mark on light / dark / primary backgrounds; at 20px, 32px, 96px; monochrome version;
clear-space diagram (25% of mark height); the incorrect-usage sheet (don't stretch, don't
recolor, don't add gradient, don't rotate).

WORDMARK: "govori", lowercase, Onest 800, -2% tracking. Lockup horizontal and stacked.

MASCOT Govo: the same squircle bubble, now a creature. Two dot eyes. No mouth. Constructed
only from squircle + circle + capsule. Five moods: idle, listening (waveform inside the body),
thinking (three dots leaving the tail, eyes up), proud (arc eyes), sleepy (half-lidded).
Also produce a 12-frame sequence of the waveform-mouth animating while listening.

Govo is a friend, not a teacher. It never frowns, never points, never turns red.
Warm, geometric, calm. Test it at 32px — if it becomes mush, simplify.
```

---

## Sinxronlash (Claude Design → repo)

Claude Code'da:

```
/design-login            # bir marta — design scope'ini bering
/design-sync             # yoki DesignSync tool'i orqali
```

**Qattiq qoidalar:**
- Har safar **bitta komponent**. `write_files` ni bitta katta bundle bilan chaqirmang.
- `finalize_plan` da yozilayotgan yo'llarni **ko'z bilan tekshiring** — bu sizning oxirgi to'siq.
- Claude Design chiqargan HTML — **spetsifikatsiya**, ishlab chiqarish kodi emas. Uni
  `shared/ui/*.tsx` ga qo'lda ko'chiring (CVA + Tailwind tokenlar bilan). Nusxa-joylashtirmang.
- Har ko'chirilgan komponent uchun: `*.test.tsx` + Storybook story + `axe` tekshiruvi.

---

## Tekshiruv ro'yxati (Claude Design natijasini qabul qilishdan oldin)

- [ ] Bir dona hardcode `#hex` yo'q — hammasi token
- [ ] Light **va** dark ikkalasi ham to'g'ri (dark = iliq ko'mir, `#000` emas)
- [ ] Talaffuz shkalasi: rang **+** chiziq uslubi **+** ikonka
- [ ] Fokus halqasi har joyda ko'rinadi
- [ ] Har ball yonida harakat bor
- [ ] Strengths → corrections tartibi buzilmagan
- [ ] Sahifa ildizida `max-width` + `margin:auto` yo'q
- [ ] Mascot 32px'da tanib bo'ladi va **bolalarcha emas**
- [ ] Matn — real o'zbekcha/ruscha, lorem ipsum emas
- [ ] `prefers-reduced-motion` hurmat qilingan
</content>
</invoke>
