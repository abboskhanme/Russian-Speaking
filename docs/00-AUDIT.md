# 00 · Audit — hozirgi holat

> Metod: butun repo o'qildi (28 migratsiya, 20 backend router/service, 40 frontend sahifa/komponent,
> 19 029 qator frontend kodi). Har bir da'vo fayl bilan tasdiqlangan.

---

## 0.1 Umumiy baho

| Qatlam | Ball | Bir jumlada |
|--------|:----:|-------------|
| Mahsulot g'oyasi | **9/10** | Bozorda real bo'shliq bor, muammo aniq, yechim to'g'ri. |
| Backend arxitektura | **6/10** | Toza yozilgan, lekin **texnik-tur** (flat) — domen chegaralari yo'q. |
| AI pipeline | **7.5/10** | Azure PA + Gemini + OpenAI fallback, circuit breaker, resume-from-transcript — jiddiy ish qilingan. |
| Ma'lumot modeli | **6.5/10** | Ishlaydi, lekin `submission.question_id` nullable = "hack" bo'lib qolgan. |
| Frontend arxitektura | **4/10** | **Ikki dizayn tizimi bir vaqtda yashayapti**, 1123 ta inline style, code-splitting yo'q. |
| Dizayn tizimi | **3.5/10** | Ikkita brend rangi, tipografik shkala yo'q, dark mode yo'q. |
| Test qamrovi | **2/10** | Backend: 1 fayl. Frontend: 0 test. AI grader uchun regressiya to'plami yo'q. |
| DevOps | **6.5/10** | Healthcheck, JSON log, Sentry, backup, CI bor. Kuzatuv (trace/cost) yo'q. |

---

## 0.2 Nima haqiqatan yaxshi (buzmang)

1. **AI pipeline'ning ishonchliligi.** `workers/tasks.py` ichida *resume-from-transcript* bor —
   retry paytida Azure STT qayta chaqirilmaydi (pul tejaladi). Bu yetuk muhandislik qarori.
2. **Circuit breaker** (`core/breaker.py`) Azure + Gemini atrofida.
3. **Scoring falsafasi** (`services/scoring.py`) — `level_score` (vazifaning o'z CEFR darajasiga
   nisbatan) headline ball qilib olingan, `overall_band` (mutlaq C2 shkalasi) diagnostikada qoldirilgan;
   headline = oxirgi 10 ta javobning o'rtachasi. Bu **psixologik jihatdan to'g'ri** va kam tebranadi.
4. **Freemium gate joyi to'g'ri** — ball ko'rsatilgandan *keyin* (qiymat momenti).
5. **Talaffuz ma'lumoti bor** — Azure per-word accuracy + prosody saqlanayapti (`WordTranscript`).
   Bu ELSA-darajadagi feature uchun xomashyo, hozir yetarlicha ishlatilmayapti.
6. **i18n uz/ru/en** boshidanoq mavjud.
7. **Orfoepiya passi** (so'zni *yozilganidek* o'qish xatosi) — rus tili uchun aqlli, nishe farq.

---

## 0.3 Kritik muammolar (dalillar bilan)

### K1 — Frontendda ikkita dizayn tizimi parallel yashaydi 🔴

- `frontend/src/index.css:1-40` → Tailwind `@theme` bloki **binafsha** brend (`--color-brand: #7c5cfc`)
  va `--color-ios-*` legacy nomlar.
- `frontend/src/index.css:150-230` → **ikkinchi** tizim: `:root` ichida **iliq krem + apelsin**
  (`--primary: oklch(0.685 0.190 47)`), izohda ochiq yozilgan: *"The Tailwind brand-* (violet) tokens
  are kept ONLY so the voice recorder visual is preserved"*.
- `components/ui.tsx` (544 q.) va `components/govori.tsx` (1449 q.) — **ikkalasida ham**
  `Button`, `Card`, `Avatar`, `Mascot`, `Ring`, `Sparkline`, `Radar/RadarChart` bor.

**Natija:** har bir yangi ekranda "qaysi Button?" degan savol tug'iladi. Rebrandingning asosiy sababi
shu — bu holatni tuzatib bo'lmaydi, faqat **almashtirish** kerak.

### K2 — Inline style monokulturasi 🔴

```
style={{ … }}  →  1123 ta
className="…"  →   727 ta
```
Tailwind v4 o'rnatilgan, lekin amalda ishlatilmaydi. Oqibatlari:
- **Dark mode imkonsiz** (inline stil media-query bilmaydi). Butun kodda `prefers-color-scheme`/`dark:`
  bor-yo'g'i **2 marta** uchraydi.
- Hover/focus/active holatlari inline stilda ifodalanmaydi → har joyda qo'l bilan `onMouseEnter`.
- CSS-in-JS objectlar har renderda qayta yaratiladi → keraksiz reconciliation.

### K3 — Code splitting yo'q 🟠

`grep "React.lazy|Suspense" → 0 natija`. `App.tsx` **barcha 38 sahifani** statik import qiladi:
o'quvchi ham admin panelini, gradebookni, RichTextEditor'ni yuklab oladi. Mobil internetda bu
to'g'ridan-to'g'ri konversiya yo'qotishi.

### K4 — `i18n.tsx` — 2339 qator, 2085 kalit, bitta TSX faylda 🟠

Uch tilning hammasi har bir foydalanuvchiga jo'natiladi. Plural/gender qoidalari yo'q
(rus tilida `1 балл / 2 балла / 5 баллов` — hozir buzuq). Tarjimon (non-dev) faylni ocholmaydi.

### K5 — God-komponentlar 🟠

| Fayl | Qator |
|---|---|
| `pages/SubmissionResult.tsx` | 1124 |
| `pages/TeacherGroupDetail.tsx` | 938 |
| `pages/CreateQuestion.tsx` | 679 |
| `App.tsx` | 555 (Sidebar + TopBar + UserMenu + LangSwitcher + Routes hammasi ichida) |

### K6 — Ma'lumot modelidagi "hack" 🟠

`models/submission.py:20-24`:
```python
# Null for shadowing/pronunciation-drill attempts (no underlying question).
question_id: Mapped[uuid.UUID | None]
reference_text: Mapped[str | None]   # shadowing uchun
```
Ya'ni `Submission` uchta har xil narsani anglatadi: vazifaga javob, shadowing urinishi, drill.
Yangi rejim (roleplay, placement test) qo'shilishi bilan bu jadval yana kengayadi va har bir
`WHERE question_id IS NOT NULL` filtri texnik qarzga aylanadi.

Xuddi shunday: `QuestionType = text | image | video` — dialog/roleplay/minimal-pair rejimlariga joy yo'q.

### K7 — Backend "texnik-tur" bo'yicha bo'lingan 🟠

```
api/v1/{auth,questions,blocks,topics,submissions,shadowing,groups,engagement,reports,…}
models/{...}  schemas/{...}  services/{...}
```
`engagement.py` = XP + streak + leaderboard + review. `submissions.py` = upload + grading + freemium
gate + teacher review. Domen chegarasi yo'q → har o'zgarish 4 ta papkaga tegadi.

### K8 — Sinxron DB, async'siz FastAPI 🟡

`db/session.py` → `create_engine` (sync). `api/v1/*` da `async def` deyarli yo'q (guest.py: 1 ta).
Har HTTP so'rov threadpool'da bloklaydi. Hozircha yuk kam — muammo emas; 1000+ o'quvchida muammo.

### K9 — SSE va'da qilingan, polling yozilgan 🟡

`ARCHITECTURE.md §5` → *"Real-time status: `GET /submissions/{id}/events` (SSE)"*.
Amalda: yo'q; frontend 2 soniyada bir marta poll qiladi. Natija sahifasida 20–40s kutish —
bu **eng muhim UX momenti** va u eng sust ishlangan.

### K10 — Testlar yo'q darajada 🔴

- Backend: `tests/test_units.py` — **bitta fayl** (XP, STT parse, breaker).
- Frontend: **0 test**.
- **AI grader uchun regressiya to'plami yo'q.** Prompt o'zgartirilsa, ballar siljiganini hech kim bilmaydi.
  AI baholovchi mahsulot uchun bu — eng katta xavf. (Batafsil: `02-ARCHITECTURE-V2.md §5.3`)

### K11 — Gigiyena 🟡

- `backend/celerybeat-schedule` — **binary fayl git'da kuzatilyapti** (hozir ham `M` holatida).
  `.gitignore`ga tushishi kerak.
- Backend worker'da **o'zbekcha string hardcode**: `tasks.py` → `title="Natija tayyor"`,
  `body=f"...Ball: {band:.0f}/100"`. Bildirishnoma tili backendga sizib kirgan.
- `Project design/` papkasi — eski prototip (2823 q. JSX). Repo ildizida turgani chalkashtiradi.

### K12 — Hujjat ↔ kod ziddiyati 🟡

| Hujjat da'vosi | Reallik |
|---|---|
| "Zustand, React Hook Form, Zod, shadcn/ui" (`ARCHITECTURE.md §2`) | `package.json`da yo'q. Faqat `useState` + `axios`. |
| "LLM: Claude (`claude-opus-4-8`)" | Amalda Gemini 2.5 Flash + OpenAI fallback. |
| "Student bottom-nav faqat 3 ta" (`PROJECT_OVERVIEW §8.9`) | Amalda: **sidebar, 7 ta element**, bottom-nav yo'q. |
| "IELTS 0–9 band" | Amalda 0–100 shkala (`a7b8c9d0e1f2` migratsiyasi). |

Rebranding shuni ham tuzatadi: hujjat kodni aks ettirishi kerak.

---

## 0.4 Xulosa — nima uchun "rebrand" emas, "restructure"

Faqat rangni almashtirish 3 hafta ish, natija esa — **o'sha ikki tizim, endi boshqa rangda.**
Haqiqiy g'alaba quyidagi 4 ta qarorda:

1. **Bitta token manbai** → light + dark + density; inline stillar o'ladi.
2. **Bitta komponent kutubxonasi** (`shared/ui`) → `ui.tsx` va `govori.tsx` o'chiriladi.
3. **`Attempt` domeni** → `Submission`ning uch xil ma'nosi ajratiladi, roleplay uchun joy ochiladi.
4. **Grader regressiya harness** → AI mahsulotni ishonch bilan o'zgartirish imkoniyati.

Qolgan hamma narsa — shu 4 tanlovning oqibati.
</content>
</invoke>
