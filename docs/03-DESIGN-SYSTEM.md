# 03 · Ovoz Design System

> **Ovoz** (o'zbekcha: *ovoz* = ovoz/tovush) — Govori mahsulotining yagona dizayn tizimi.
> Bu hujjat **normativ**: bu yerda yo'q narsa mahsulotda ham yo'q.
> Bugungi `ui.tsx` + `govori.tsx` + `index.css`ning ikkita rang tizimi shu bilan **almashtiriladi**.

---

## 3.1 Brend

### Nom va ovoz

| | |
|---|---|
| **Nom** | **Govori** · `govorim.uz` |
| **Wordmark** | `govori` — kichik harflar, display shrift, `-2%` tracking |
| **Slogan (uz)** | *Erkin gapir.* |
| **Slogan (ru)** | *Говори свободно.* |
| **Slogan (en)** | *Speak freely.* |

**Brend ovozi:** iliq, tinch, hech qachon hukm qilmaydi. O'qituvchi emas — **yoningdagi do'st**
kim rus tilini yaxshi biladi.

- ✅ *"Yaxshi bo'ldi. Endi bitta narsani birga tuzataylik."*
- ❌ *"Xato! Grammatika: 42/100."*
- ✅ *«Тебя поняли. Слово «магази́н» — ударение на «и».»*
- ❌ *«Неверное произношение.»*

### Dizayn shaxsiyati

> **Cozy, cute-but-not-childish.**
> Dumaloq geometriya, cheklangan palitra, sokin yuzalar, kuchli bitta urg'u rangi.
> Hech qachon: gradient-boyalgan tugma, 3D emoji, komik shrift, sakrab-yuruvchi animatsiya.

---

## 3.2 Mascot — **Govo**

**Nima:** gaplashuv pufagi (speech bubble) shaklidagi mavjudot. Squircle tana + quyruq + ikkita
nuqta ko'z. **Og'zi yo'q** — chunki:

> 🔑 **Asosiy g'oya: Govo gapirganda, uning og'zi — jonli waveform.**
> O'quvchi mikrofonga gapirsa, Govo'ning ichida to'lqin harakatlanadi. Mascot va mahsulotning
> yadro o'zaro ta'siri **bitta narsa** bo'ladi.

**Qurilish qoidasi:** faqat 3 ta primitivdan — squircle, doira, kapsula. Qo'l/oyoq yo'q.
Chiziq qalinligi doim `3px @ 96px` (proportsional).

**Kayfiyatlar (5 ta, ko'p emas):**

| Mood | Qachon | Ko'rinish |
|---|---|---|
| `idle` | bo'sh holat, kutish | ko'zlar ochiq, sekin "nafas" (scale 1↔1.02, 4s) |
| `listening` | yozuv ketmoqda | ichida jonli waveform, ko'zlar biroz katta |
| `thinking` | AI baholayapti | ko'zlar yuqoriga, quyruqdan 3 ta nuqta chiqadi |
| `proud` | ball ≥ 70 | ko'zlar yoy (^^), biroz qiyshaygan |
| `sleepy` | streak yo'qolgan, bo'sh ro'yxat | ko'zlar yarim yopiq. **Hech qachon xafa/yig'lagan emas.** |

**Taqiq:** Govo hech qachon xato ustidan kulmaydi, barmoq bilan ko'rsatmaydi, qizarmaydi.

### Logo mark

Squircle pufak, ichida **3 ta ko'tarilgan vertikal bar** (waveform + o'sish).
`mark` bir o'zi ishlaydi (favicon, app icon), `mark + wordmark` — asosiy lockup.

```
┌─────────┐
│  ▁ ▄ █  │   ← 3 bar, radiuslar bir xil (r-pill)
└──╲──────┘   ← quyruq: chap-past, 45°
```

Minimal o'lcham: mark 20px, lockup 96px kenglik. Clear space = mark balandligining 25%.

---

## 3.3 Rang

Barcha ranglar **OKLCH** — perceptual bir tekislik, dark mode uchun mexanik hisoblanadi.

### Brend

| Token | Light | Dark | Ishlatilishi |
|---|---|---|---|
| `--primary` | `oklch(0.665 0.185 40)` | `oklch(0.720 0.170 42)` | Yagona harakat rangi. Sahifada **bitta** primary tugma. |
| `--primary-press` | `oklch(0.595 0.180 38)` | `oklch(0.660 0.165 40)` | `:active` |
| `--primary-tint` | `oklch(0.945 0.038 48)` | `oklch(0.300 0.055 42)` | tanlangan nav, chip foni |
| `--primary-tint-2` | `oklch(0.905 0.068 46)` | `oklch(0.360 0.070 42)` | tint ustidagi chegara |
| `--primary-on` | `oklch(0.995 0.004 60)` | `oklch(0.180 0.020 45)` | primary ustidagi matn |
| `--accent` | `oklch(0.545 0.155 272)` | `oklch(0.680 0.140 272)` | progress, premium, ma'lumot vizuali |
| `--accent-tint` | `oklch(0.945 0.035 272)` | `oklch(0.300 0.055 272)` | |

> **Nega Ember (hue 40), Duolingo-yashil emas?** Yashil = "to'g'ri/xato" semantikasiga tegib ketadi;
> talaffuz rangli belgilanadigan mahsulotda brend rangi **semantik ranglardan ajralib turishi shart**.
> Hue 40 — iliq, energiya, ovoz; semantik yashil (155) / qahrabo (82) / atirgul (20) dan uzoq.
> Atirgul (danger, 20) bilan farqni **to'yinganlik + yorug'lik** ushlab turadi.

### Yuza va siyoh

| Token | Light | Dark |
|---|---|---|
| `--bg` | `oklch(0.973 0.010 72)` | `oklch(0.190 0.012 60)` |
| `--surface` | `oklch(0.998 0.003 80)` | `oklch(0.235 0.014 60)` |
| `--surface-2` | `oklch(0.978 0.008 76)` | `oklch(0.275 0.016 60)` |
| `--surface-3` | `oklch(0.958 0.013 74)` | `oklch(0.315 0.018 60)` |
| `--ink` | `oklch(0.270 0.024 55)` | `oklch(0.965 0.008 75)` |
| `--ink-soft` | `oklch(0.450 0.020 58)` | `oklch(0.830 0.012 72)` |
| `--muted` | `oklch(0.600 0.018 62)` | `oklch(0.680 0.014 68)` |
| `--faint` | `oklch(0.745 0.014 68)` | `oklch(0.520 0.012 64)` |
| `--line` | `oklch(0.910 0.011 72)` | `oklch(0.320 0.014 60)` |
| `--line-2` | `oklch(0.862 0.016 70)` | `oklch(0.400 0.016 60)` |

Dark mode **hech qachon `#000`** — iliq ko'mir (`chroma 0.012`, `hue 60`). Kechqurun mashq qilish
qulay bo'lsin.

### Semantik

| Token | Light | Dark | Ma'no |
|---|---|---|---|
| `--success` | `oklch(0.640 0.140 155)` | `oklch(0.720 0.130 155)` | to'g'ri, bajarildi |
| `--warn` | `oklch(0.760 0.135 82)` | `oklch(0.800 0.125 82)` | e'tibor |
| `--danger` | `oklch(0.605 0.170 20)` | `oklch(0.680 0.160 20)` | xato, o'chirish |
| `--info` | `oklch(0.600 0.115 245)` | `oklch(0.700 0.105 245)` | maslahat |
| + har biriga `-tint` | `L 0.945, C ÷4` | `L 0.300, C ÷2.5` | fon |

### Talaffuz shkalasi (per-word)

| Daraja | Rang | **Rangdan tashqari signal (majburiy)** |
|---|---|---|
| `good` (≥ 80) | `--success` | tekis pastki chiziq |
| `mid` (60–79) | `--warn` | **nuqtali** pastki chiziq |
| `low` (< 60) | `--danger` | **to'lqinli** pastki chiziq + ⚠︎ ikonka |
| `neutral` | `--muted` | chiziqsiz |

> **A11y qoidasi:** hech qachon faqat rang. Deyteranopiyada yashil↔qahrabo ajratilmaydi.
> Chiziq uslubi + ikonka har doim hamroh bo'ladi. Bu **tekshiriladigan** talab (`axe` + qo'lda).

### Kontrast talablari

- Matn: **≥ 4.5:1**; katta matn (≥ 24px yoki ≥ 19px bold): ≥ 3:1.
- Interaktiv chegara / ikonka: ≥ 3:1.
- `--primary` ustidagi oq matn: light rejimda tekshirilgan (`primary-on`), dark rejimda **qora** matn.
- Fokus halqasi: 2.5px `--primary`, 2px offset, **har doim ko'rinadi** (`:focus-visible`).

---

## 3.4 Tipografiya

| Rol | Shrift | Sabab |
|---|---|---|
| **Display + UI** | **Onest** (400/500/600/700/800) | To'liq Kirill + Lotin + o'zbek diakritikasi (`ʻ`), geometrik-gumanistik, iliq, ammo bolalarcha emas. |
| **Mono** | **JetBrains Mono** (400/500) | Transkript, vaqt kodlari, fonemalar. Kirill qo'llab-quvvatlaydi. |
| Fallback | `Nunito, system-ui, sans-serif` | Migratsiya davrida. |

> Nunito nima uchun almashtiriladi: u juda dumaloq va "bolalar kitobi" tomon og'adi; brief esa
> *cute-but-**not**-childish* deydi. Onest o'sha iliqlikni saqlab, kattalarga mos qat'iylik beradi.
> Muqobil (agar ruscha xarakter kuchliroq kerak bo'lsa): **Golos Text**.

### Shkala

| Token | Size / Line | Weight | Tracking | Ishlatilishi |
|---|---|---|---|---|
| `--t-score` | 56 / 56 | 800 | −3% | Ball raqami (tabular-nums) |
| `--t-display` | 40 / 44 | 800 | −2.5% | Onboarding, marketing |
| `--t-title-l` | 26 / 32 | 800 | −2% | Sahifa sarlavhasi |
| `--t-title-m` | 20 / 26 | 700 | −1.5% | Karta sarlavhasi |
| `--t-title-s` | 17 / 24 | 700 | −1% | Ro'yxat sarlavhasi |
| `--t-body-l` | 16 / 25 | 500 | 0 | Vazifa matni, transkript |
| `--t-body` | 15 / 22 | 500 | 0 | **Standart** |
| `--t-body-s` | 13.5 / 19 | 500 | 0 | Ikkilamchi |
| `--t-label` | 11.5 / 14 | 800 | +6% UPPER | Bo'lim yorlig'i |
| `--t-mono` | 13.5 / 21 | 400 | 0 | Transkript, phoneme |

**Qoidalar:**
- Bir ekranda **≤ 4** matn o'lchami.
- Barcha raqamlar (ball, XP, streak) → `font-variant-numeric: tabular-nums`.
- Ruscha matn `--t-body-l` dan kichik bo'lmasin (Kirill x-height pastroq).
- Uzunlik: o'qish matni ≤ 72ch. **Ammo sahifa ildizi baribir to'liq kenglikda** — cheklov
  matn blokida, sahifada emas.

---

## 3.5 Fazo, radius, soya, motion

### Fazo (4px baza)
`--s-1:4 · --s-2:8 · --s-3:12 · --s-4:16 · --s-5:20 · --s-6:24 · --s-8:32 · --s-10:40 · --s-12:48 · --s-16:64`

Zichlik (density): `comfortable` (default, o'quvchi) va `compact` (o'qituvchi jadvallari) —
`[data-density="compact"]` barcha vertikal padding'ni `×0.75` qiladi.

### Radius
`--r-xs:10 · --r-sm:14 · --r-md:18 · --r-lg:24 · --r-xl:32 · --r-pill:999`

Ichma-ich joylashuv qoidasi: `ichki_radius = tashqi_radius − padding`. (Karta `r-lg` + `16px` padding →
ichidagi tugma `r-xs`.)

### Elevatsiya (iliq tusli soyalar, sovuq kul emas)
| Token | Ishlatilishi |
|---|---|
| `--e-0` | none — chegara bilan ajralgan yuza |
| `--e-1` | karta (`0 1px 2px / 0 2px 6px`) |
| `--e-2` | dropdown, popover |
| `--e-3` | modal, sheet |
| `--e-primary` | primary tugma (`0 6px 18px primary/30%`) |

Dark rejimda soya **kuchsizlanadi**, o'rniga `--surface` yorqinligi 1 pog'ona ko'tariladi.

### Motion

| Token | Davomiylik | Egri | Ishlatilishi |
|---|---|---|---|
| `--m-instant` | 90ms | `ease-out` | hover, tint |
| `--m-fast` | 140ms | `cubic-bezier(.2,.7,.3,1)` | tugma press, toggle |
| `--m-base` | 220ms | `cubic-bezier(.2,.7,.3,1)` | sahifa/karta kirishi |
| `--m-slow` | 380ms | `cubic-bezier(.16,1,.3,1)` | modal, sheet |
| `--m-spring` | 520ms | `cubic-bezier(.2,.9,.25,1.15)` | **ball ochilishi** (faqat shu yerda) |

**Motion qoidalari:**
- Har `:active` → `scale(0.96)` (`.tap`). Bu tizimning "his"i.
- Ball raqami **count-up** qiladi (0 → N, 900ms, ease-out), keyin konfetti (bir marta, ≥ 70 ball).
- `@media (prefers-reduced-motion: reduce)` → barcha animatsiya `0.001s`, konfetti umuman yo'q,
  count-up darhol yakuniy qiymat. (Hozirgi `index.css`da bu **bor** — saqlanadi.)

### Haptika + tovush (mobil)
| Hodisa | Haptik | Tovush |
|---|---|---|
| Yozuv boshlandi | `light` | past "pop" (100ms) |
| Yozuv tugadi | `medium` | yuqori "pop" |
| Ball ochildi (≥70) | `success` | yumshoq akkord |
| Xato / paywall | `warning` | **tovush yo'q** (jazolamaymiz) |

---

## 3.6 Komponent inventari

> **Bitta joy:** `frontend/src/shared/ui/`. Har komponent: `Component.tsx` + `Component.stories.tsx`
> + `Component.test.tsx`. Variantlar **CVA** bilan, prop emas-`className` orqali.

### Foundations
`Icon` (24×24 grid, 1.75px stroke, 40 ta ikonka) · `Text` · `Stack/Row/Col` · `Spacer` · `VisuallyHidden`

### Actions
| Komponent | Variantlar | Holatlar |
|---|---|---|
| `Button` | `primary · secondary · ghost · danger · success` × `sm · md · lg` | default, hover, active(scale .96), focus-visible, loading, disabled |
| `IconButton` | ghost, solid | + tooltip |
| `Fab` | primary | mobil "gapirish" tugmasi |
| `SegmentedControl` | | |
| `Toggle` | | |

### Containment
`Card` (`flat · raised · outline · tint`) · `Sheet` (mobil: to'liq balandlik) · `Dialog` (Radix) ·
`Popover` · `DropdownMenu` (Radix) · `Tooltip` · `Accordion` · `Tabs`

### Forms
`Input` · `Textarea` · `Select` · `Checkbox` · `Radio` · `Slider` · `PhoneInput` (+998 mask) ·
`RichTextEditor` (mavjud, DS'ga moslanadi) · `FileDrop` · `FormField` (label + hint + error + a11y bog'lash)

### Feedback
`Skeleton` · `Spinner` · `ProgressBar` · `Toast` · `EmptyState` (Govo bilan) · `ErrorState` ·
`Paywall` · `Confetti`

### Data
`Stat` · `StatTile` · `DataTable` (sticky header, mobil → kartochka) · `Sparkline` · `LineChart` ·
`BarChart` · `RadarChart` · `Ring` · `Bar` · `Badge` · `Pill` · `Avatar` · `AvatarGroup` · `Pagination`

### Domenga xos (mahsulot yuragi)
| Komponent | Tavsif |
|---|---|
| **`Recorder`** | Mikrofon tugmasi + jonli waveform (canvas) + timer + tayyorgarlik countdown. **Govo'ning og'zi shu yerda.** |
| **`Waveform`** | Jonli (AnalyserNode) va statik (yozilgan audio) rejimlar. |
| **`ScoreReveal`** | Halqa + count-up + 4 mezon bar + konfetti. |
| **`CriterionRow`** | Mezon + ball + **"qanday yaxshilash" tugmasi** (raqam hech qachon yolg'iz emas). |
| **`WordTranscript`** | Per-word rangli + chiziq uslubi + tap → fonema breakdown + **so'zni eshitish** (TTS). |
| **`CorrectionCard`** | `original → corrected` diff, tur belgisi, 1 gaplik izoh. Maks 3 ta ko'rinadi. |
| **`PhonemeChip`** | `[ɕː]` + accuracy. |
| **`MinimalPairDrill`** | ы/и tanlash mashqi. |
| **`StreakFlame`** | Alanga + freeze holati. **Yo'qolganda kulrang, hech qachon qizil emas.** |
| **`AchievementCard`** | Ochilgan / qulflangan. |
| **`Mascot`** | 5 mood, waveform-og'iz rejimi. |
| **`ModuleCard`** | Cover + progress + qulf (freemium). |
| **`AttemptRow`** | Sana + ball + holat + trend o'qi. |
| **`ClassInsightCard`** | "12 o'quvchi *родительный падеж*da qoqildi → Remediation topshirish". |
| **`RoleplayBubble`** | Suhbat turn'i (AI / o'quvchi), audio play + transkript. |

---

## 3.7 Naqshlar (patterns)

### Ball ko'rsatish (eng muhim ekran)
```
1. Halqa + count-up (0→74, 900ms)          ← faqat bitta katta raqam. overall_band YASHIRIN.
2. Bitta jumla: «Тебя легко понять.»        ← summary, ≤ 12 so'z
3. ✅ Kuchli tomonlar (2 ta)                 ← HAR DOIM birinchi
4. Transkript (per-word rangli)             ← tap → fonema + eshit
5. ✏️ Tuzatishlar (maks 3) + «Barchasi (7)»
6. 4 mezon bar + har birida «Yaxshilash →»
7. [Qayta urinish]  [Namuna javobni eshitish]
```
Bo'sh yuza ≥ 40% — natija sahifasi **hujjat** emas, **xabar**.

### Bo'sh holat
Govo (`sleepy`) + bitta jumla + **bitta** harakat tugmasi. Illyustratsiya ≤ 120px.

### Yuklanish
**Har doim skeleton**, hech qachon to'liq sahifa spinner. Skeleton — real layoutning shakli.
AI kutish ekrani — istisno: Govo `thinking` + bosqich indikatori (§04 §4.6).

### Xato
Nima bo'ldi (odam tilida) + nima qilish mumkin + [Qayta urinish]. Stack trace hech qachon.
Ovoz yozuvi **hech qachon yo'qolmasin** — localda saqlanadi, qayta yuboriladi.

### Paywall
Faqat ball ko'rsatilgandan **keyin**. Sarlavha: *"Bugungi 3 ta bepul urinishing tugadi."*
Va **hech qachon** o'quvchini "yomon" his qildirmaydi. Alternativa taklif etiladi:
*"Shadowing hali ham bepul — mashq qilishda davom et."*

---

## 3.8 Layout va breakpointlar

| Nom | Kenglik | Shell |
|---|---|---|
| `sm` | < 720px | **Bottom nav (3 ta: Bosh · Mashq · Progress)** + FAB "Gapirish". Sidebar → drawer. |
| `md` | 720–1080 | Sidebar (icon-only, 72px) + kontent |
| `lg` | 1080–1440 | Sidebar (250px) + kontent |
| `xl` | > 1440 | Sidebar + kontent + o'ng panel (kontekst: streak, keyingi vazifa) |

**To'liq kenglik qoidasi (o'zgarmas):** sahifa ildizida hech qachon `mx-auto max-w-*`.
Kontent nafas olishi uchun **ichki** grid ustunlari ishlatiladi (`.split`, `.g3`), sahifa emas.

**Muhim tuzatish:** brief va `PROJECT_OVERVIEW.md` o'quvchi uchun **3 elementli bottom nav** va'da
qiladi; hozirgi kod 7 elementli sidebar beradi. **Brief g'olib** — o'quvchi navigatsiyasi
3 taga qisqartiriladi (§04 §4.1).

---

## 3.9 Kirish imkoniyati (a11y) — chiqarish shartlari

- [ ] Barcha interaktiv element ≥ **44×44px** teginish maydoni.
- [ ] `:focus-visible` har joyda ko'rinadi; klaviatura bilan **butun** yozuv oqimi bajariladi.
- [ ] Radix primitivlar (Dialog/Menu/Tabs) → to'g'ri `role`, `aria-expanded`, focus trap.
      *(Hozirgi qo'lbola dropdownlar `App.tsx`da — a11y'siz.)*
- [ ] Rang **hech qachon yagona signal** emas (talaffuz shkalasi §3.3).
- [ ] Yozuv holati `aria-live="polite"` bilan e'lon qilinadi: "Yozuv boshlandi", "Baholanmoqda".
- [ ] Transkript screen-reader uchun **oddiy matn** sifatida ham mavjud.
- [ ] `prefers-reduced-motion` hurmat qilinadi.
- [ ] Kontrast: WCAG **AA** minimal, matn uchun AAA'ga intilamiz.
- [ ] Mikrofon ruxsati rad etilsa — tushunarli qayta tiklash yo'li.
- [ ] CI'da `axe` avtomatik tekshiruvi (Playwright bilan).

---

## 3.10 Tokenlar → kod

**Yagona manba:** `frontend/src/shared/styles/tokens.css`

```css
@import "tailwindcss";

@theme {
  --color-primary:      oklch(0.665 0.185 40);
  --color-primary-press:oklch(0.595 0.180 38);
  --color-primary-tint: oklch(0.945 0.038 48);
  --color-accent:       oklch(0.545 0.155 272);
  --color-success:      oklch(0.640 0.140 155);
  --color-warn:         oklch(0.760 0.135 82);
  --color-danger:       oklch(0.605 0.170 20);
  --color-info:         oklch(0.600 0.115 245);
  --color-bg:           oklch(0.973 0.010 72);
  --color-surface:      oklch(0.998 0.003 80);
  --color-ink:          oklch(0.270 0.024 55);
  /* … */
  --radius-xs: 10px;  --radius-sm: 14px;  --radius-md: 18px;
  --radius-lg: 24px;  --radius-xl: 32px;
  --font-display: "Onest", "Nunito", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

:root[data-theme="dark"] {
  --color-bg:      oklch(0.190 0.012 60);
  --color-surface: oklch(0.235 0.014 60);
  --color-ink:     oklch(0.965 0.008 75);
  --color-primary: oklch(0.720 0.170 42);
  /* … */
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* bir xil override */ }
}
```

**Taqiqlar (CI lint bilan):**
- ❌ Komponentda `#hex` yoki `rgb()`. Faqat token.
- ❌ `style={{ color: ... }}` — dinamik geometriya (waveform balandligi, progress %) dan tashqari.
- ❌ `ui.tsx` / `govori.tsx` dan import (migratsiya tugagach fayllar o'chadi).
- ❌ Sahifa ildizida `max-w-*` + `mx-auto`.

---

## 3.11 Migratsiya tartibi (ekran bo'yicha)

| # | Ekran | Nega bu tartib |
|---|---|---|
| 1 | `Recorder` + `Waveform` + `Mascot` | Yadro o'zaro ta'siri; brendning "his"i shu yerda tug'iladi. |
| 2 | `SubmissionResult` → `AttemptResult` | Eng qadrli moment + eng katta fayl (1124 q.). |
| 3 | `StudentHome` | Birinchi taassurot. |
| 4 | `AnswerQuestion` → `AnswerTask` | |
| 5 | `Shadowing`, `StudentProgress`, `Leaderboard` | |
| 6 | Auth (`Login`, `Register`, `CompleteProfile`) | |
| 7 | O'qituvchi ekranlari (`compact` density bilan) | |
| 8 | Admin | |
| 9 | 🔥 `ui.tsx` + `govori.tsx` + violet `@theme` bloki **o'chiriladi** | |
</content>
</invoke>
