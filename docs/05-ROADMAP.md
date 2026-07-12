# 05 · Yo'l xaritasi

> Printsip: **har faza o'z-o'zicha relizga chiqadi.** Hech qachon "3 oy hech narsa chiqmaydi" davri.
> Har faza oxirida: Docker'da ishlaydi → foydalanuvchi tekshiradi → commit.

Vaqt baholari — **1 dev + Claude Code** uchun. Ular majburiyat emas, tartib uchun.

---

## Faza 0 · Poydevor tozalash — *~3 kun*

Rebrandingdan **oldin** qilinadigan, ko'rinmas, ammo hamma narsani osonlashtiradigan ish.

| # | Ish | DoD |
|---|---|---|
| 0.1 | `backend/celerybeat-schedule` → `.gitignore` + `git rm --cached` | `git status` toza |
| 0.2 | `Project design/` → `archive/legacy-prototype/` yoki o'chirish | Repo ildizi toza |
| 0.3 | Eski hujjatlar (`ARCHITECTURE.md`, `PROJECT_OVERVIEW.md`, `UPGRADE_PLAN.md`) → `docs/legacy/` | `docs/` yagona manba |
| 0.4 | `Notification.params: JSONB` migratsiyasi; worker'dagi o'zbekcha stringlar o'chadi | `tasks.py` da hech qanday UI matni yo'q |
| 0.5 | CI: `ruff` + `pytest` + `tsc` + `vite build` + **bundle-size budget** | CI yashil, budget 180KB gz |
| 0.6 | ESLint: `boundaries` + `no-inline-styles` (warn), `no-hex-colors` (warn) | Lint ishlaydi |

---

## Faza 1 · Grader ishonchliligi — *~4 kun* 🔴 **eng yuqori ROI**

Rebrandingdan oldin. Chunki keyingi hamma o'zgarish AI'ga tegadi va **hozir xavfsizlik to'ri yo'q.**

| # | Ish | DoD |
|---|---|---|
| 1.1 | `tests/golden/` — 40 ta klip + `expected.yaml` | Fayl bor, litsenziya/rozilik hujjatlashtirilgan |
| 1.2 | `test_grader_golden.py` — real API, sekin marshrut (`-m golden`) | Lokalda ishlaydi |
| 1.3 | `Evaluation.prompt_version`, `cost_usd` ustunlari | Migratsiya qo'llanadi |
| 1.4 | CI: prompt o'zgarsa → golden run; < 90% → PR bloklanadi | Sun'iy regressiya bilan tekshirilgan |
| 1.5 | Prometheus: `ai_cost_usd_total`, `stage_failures_total`, `grade_duration_seconds` | `/metrics` chiqadi |
| 1.6 | Backend test qamrovi: auth, freemium gate, scoring, pipeline (mock) → **≥ 60%** | `pytest --cov` |

**Nega birinchi:** AI baholovchi mahsulotning yagona haqiqiy va'dasi — **adolatli ball**.
U jimgina buzilsa, foydalanuvchi ketadi va siz sababini bilmaysiz.

---

## Faza 2 · Ovoz Design System — *~2 hafta*

| # | Ish | DoD |
|---|---|---|
| 2.1 | `shared/styles/tokens.css` — light + dark, `@theme` | Dark mode toggle ishlaydi |
| 2.2 | Onest + JetBrains Mono (self-hosted, `woff2`, subset: lat+cyr) | LCP regress yo'q |
| 2.3 | `shared/ui/` — Foundations, Actions, Containment, Forms, Feedback, Data (§03 §3.6) | Storybook'da 100% |
| 2.4 | Radix: Dialog, DropdownMenu, Tabs, Tooltip, Popover | Qo'lbola dropdownlar o'chdi |
| 2.5 | **`Mascot` (5 mood) + waveform-og'iz** + `Recorder` + `Waveform` | Prototip ekranda |
| 2.6 | Logo mark + wordmark (SVG, favicon, PWA icon set) | Brend paketi tayyor |
| 2.7 | `Confetti`, `ScoreReveal` (count-up + spring) | `prefers-reduced-motion` hurmat qilinadi |
| 2.8 | Chart oilasi (Radar, Line, Bar, Sparkline, Ring) — bitta rang tizimi | |
| 2.9 | `axe` CI tekshiruvi | 0 critical |

**Chiqish:** Storybook + `claude.ai/design` loyihasi (§06). Kod hali ko'chirilmagan.

---

## Faza 3 · Frontend restructure + ekran migratsiyasi — *~3 hafta*

Strangler Fig tartibi (§03 §3.11):

| # | Ish | DoD |
|---|---|---|
| 3.1 | FSD skeleti + `boundaries` lint + `lazy()` marshrutlar (3 bundle) | Student initial JS ≤ 180KB gz |
| 3.2 | `i18next` + `locales/*.json` (2085 kalit ko'chiriladi) + ICU plural (ru) | `«2 балла»` to'g'ri |
| 3.3 | Recorder → Result → Home → AnswerTask ko'chirildi | Golden path Playwright'da yashil |
| 3.4 | **`Practice`** birlashtirilgan sahifa (5 tab) + **3 elementli bottom nav** | Mobil navigatsiya |
| 3.5 | Progress + Leaderboard birlashdi | |
| 3.6 | Auth + Onboarding (placement markazda) | TTFV < 5 daq (o'lchandi) |
| 3.7 | O'qituvchi ekranlari (`compact` density) | |
| 3.8 | Admin | |
| 3.9 | 🔥 `ui.tsx`, `govori.tsx`, violet `@theme` **o'chirildi** | `grep "#7c5cfc"` → 0 |
| 3.10 | `SubmissionResult.tsx` (1124 q.) → 6 widget, har biri ≤ 200 q. | |
| 3.11 | Vitest + Playwright + a11y CI | |

---

## Faza 4 · Backend domenlari + tezlik — *~2 hafta*

| # | Ish | DoD |
|---|---|---|
| 4.1 | `domains/` skeleti; `identity`, `catalog` ko'chirildi | Import lint yashil |
| 4.2 | **`Attempt` agregati** + migratsiya (`Submission` → `Attempt`, `kind` backfill) | Nol downtime, eski API alias |
| 4.3 | `Question`→`Task`, `QuestionBlock`→`Module` rename (2 bosqichli) | |
| 4.4 | `Entitlement` xizmati; tarqalgan `is_premium` if'lari o'chdi | `entitlements.can()` bitta joyda |
| 4.5 | Pipeline stage'lari + `StageResult` + parallel (pronounce ∥ orthoepy) | |
| 4.6 | **SSE** `/attempts/{id}/events` + kutish ekrani bosqichlari | **TTFS p95 < 20s** (o'lchandi) |
| 4.7 | OpenTelemetry (HTTP → Celery → provider) | Trace Grafana'da |
| 4.8 | Redis cache: leaderboard, stats, public settings | |
| 4.9 | Audio saqlash siyosati: 90 kun → S3 lifecycle | |

---

## Faza 5 · Farqlovchi funksiyalar — *~4 hafta*

Tartib **qiymat / murakkablik** bo'yicha:

| # | Feature | Faza | DoD |
|---|---|---|---|
| 5.1 | **F5 · Xato-replay drill (SRS UI)** | 3 kun | `ReviewItem` modeli bor — faqat UI. Tugatish validatsiya qilinadi. |
| 5.2 | **F7 · Real-time natija** | (4.6'da) | |
| 5.3 | **F2 · Fonema drill + minimal juftliklar** | 1 hafta | `MinimalPair` seed (ы/и, ш/щ, ударение), tap-to-hear |
| 5.4 | **F3 · Kunlik 5 daqiqa** | 4 kun | Streak +1, 3 qadam avtomatik yig'iladi |
| 5.5 | **F4 · Placement test** | 4 kun | 3 savol → CEFR + personalizatsiya |
| 5.6 | **F1 · Roleplay** 🎯 | 2 hafta | 10 ssenariy, turn-based, xavfsizlik prompt'i, yakuniy hisobot |
| 5.7 | **F6 · Sinf insaytlari** | 1 hafta | "12 o'quvchi X'da qoqildi → 1 tap remediation" |
| 5.8 | Achievement backend | 3 kun | Frontend kartochkalari nihoyat real |

---

## Faza 6 · O'sish va pul — *~2 hafta*

| # | Ish |
|---|---|
| 6.1 | **F10 · Payme + Click**, avto-yangilanish, chek |
| 6.2 | Plans sahifasi (Bepul / Pro / Sinf / Maktab) |
| 6.3 | **F8 · Telegram bot** — eslatma, streak, mikro-shadowing |
| 6.4 | **F9 · PWA** + offline yozuv navbati (IndexedDB) |
| 6.5 | Referal: o'qituvchi kodi → o'quvchi 7 kun Pro |
| 6.6 | Analytics: PostHog/Amplitude — WSM, TTFV, funnel |

---

## Xavflar va yumshatish

| Xavf | Ehtimol | Ta'sir | Yumshatish |
|---|:---:|:---:|---|
| **"Big bang" rebrand → 2 oy reliz yo'q** | O | Yuqori | Strangler Fig. Har sahifa alohida PR. |
| Grader prompt regressiyasi jimgina | Y | Yuqori | **Faza 1 birinchi.** Golden set CI'da. |
| Roleplay AI xarajati portlaydi | O | Yuqori | Turn limiti (10), foydalanuvchi kunlik AI byudjeti, arzon model + eskalatsiya |
| Gemini free-tier kvotasi tugaydi | Y | O'rta | OpenAI fallback **bor**; Azure OpenAI qo'shiladi; breaker bor |
| Onest shrifti Kirill'da to'liq emas | P | O'rta | Faza 2.2'da tekshiriladi; muqobil **Golos Text** |
| Mascot "bolalarcha" chiqadi | O | O'rta | 3 primitiv qoidasi + 5 mood cheklovi + kattalarga test |
| Ovoz ma'lumoti maxfiyligi (voyaga yetmaganlar) | O | Yuqori | 90 kunlik saqlash, rozilik ekrani, eksport/o'chirish |
| Domen rename (`Submission`→`Attempt`) prod'ni buzadi | O | Yuqori | 2 bosqichli migratsiya + restore-drill |

---

## Ketma-ketlik (bitta rasmda)

```
Faza 0 ─ tozalash (3 kun)
   ↓
Faza 1 ─ GRADER XAVFSIZLIK TO'RI (4 kun)     ← bularsiz qolgani xavfli
   ↓
Faza 2 ─ Ovoz DS (2 hafta)  ────────────┐
   ↓                                     │  (parallel bo'lishi mumkin)
Faza 3 ─ Frontend migratsiya (3 hafta)   │
   ↓                                     │
Faza 4 ─ Backend domenlari + SSE (2 hafta)◄┘
   ↓
Faza 5 ─ Roleplay, drill, kunlik 5 daqiqa (4 hafta)   ← mahsulot farqi
   ↓
Faza 6 ─ Payme/Click, Telegram, PWA (2 hafta)         ← pul va o'sish
```

**Jami: ~13–14 hafta.** Har 1–2 haftada relizga chiqadigan narsa bor.

---

## Har faza uchun umumiy Definition of Done

- [ ] `docker compose up --build` — barcha servis `healthy`
- [ ] Migratsiyalar `upgrade head` + `downgrade -1` ikkalasi ham ishlaydi
- [ ] `pytest` yashil, qamrov tushmadi
- [ ] `tsc` + `vite build` yashil; bundle budget buzilmadi
- [ ] Playwright golden path yashil
- [ ] `axe` — 0 critical
- [ ] Yangi ekran mobil (375px) va desktop (1440px) da tekshirildi
- [ ] Dark mode tekshirildi
- [ ] `docs/` yangilandi (kod hujjatga mos)
</content>
</invoke>
