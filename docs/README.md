# Govori — Rebranding & Rearchitecture Dossier

> Yaratilgan: 2026-07-09 · Manba: `Russian-Speaking` repo to'liq auditi (backend + frontend + docs + git)
> Maqsad: mavjud MVP'ni **dunyo darajasidagi mahsulot**ga aylantirish — brend, dizayn tizimi,
> axborot arxitekturasi va texnik poydevorni noldan qayta qurish.

Bu papka — bitta manba (single source of truth). Eski `ARCHITECTURE.md`, `PROJECT_OVERVIEW.md`,
`UPGRADE_PLAN.md` **tarixiy hujjat** sifatida qoladi; ular bilan bu hujjatlar ziddiyatga tushsa,
**shu papka ustun**.

## Fayllar

| # | Fayl | Nima uchun |
|---|------|-----------|
| 00 | [`00-AUDIT.md`](./00-AUDIT.md) | Hozirgi holat: nima yaxshi, nima chirigan. Dalillar bilan (fayl:qator). |
| 01 | [`01-PRODUCT-STRATEGY.md`](./01-PRODUCT-STRATEGY.md) | Kimga, nima uchun, raqobat, pozitsiya, metrikalar, biznes-model. |
| 02 | [`02-ARCHITECTURE-V2.md`](./02-ARCHITECTURE-V2.md) | Backend + frontend maqsad arxitekturasi, migratsiya yo'li. |
| 03 | [`03-DESIGN-SYSTEM.md`](./03-DESIGN-SYSTEM.md) | **Ovoz DS** — brend, tokenlar, tipografiya, komponentlar, motion, a11y. |
| 04 | [`04-UX-FLOWS.md`](./04-UX-FLOWS.md) | IA, navigatsiya, ekran-ba-ekran spetsifikatsiya, asosiy oqimlar. |
| 05 | [`05-ROADMAP.md`](./05-ROADMAP.md) | ⚠️ **ESKIRGAN** → `08` ga qarang. Python'ni joyida yaxshilash uchun edi. |
| 06 | [`06-CLAUDE-DESIGN-PROMPT.md`](./06-CLAUDE-DESIGN-PROMPT.md) | **Claude Design uchun tayyor prompt** (copy-paste). |
| **07** | [`07-ARCHITECTURE-DOTNET.md`](./07-ARCHITECTURE-DOTNET.md) | 🔴 **Amaldagi arxitektura.** Backend = C#/.NET 9. `02` ning backend qismini almashtiradi. |
| **08** | [`08-REWRITE-PLAN.md`](./08-REWRITE-PLAN.md) | 🔴 **Amaldagi reja.** Fazalar, cutover, tozalash. `05` ni almashtiradi. |
| 09 | [`09-DOCKER.md`](./09-DOCKER.md) | Stack'ni ko'tarish: servislar, portlar, loglar, sxema egaligi. |
| — | [`design/`](./design/README.md) | **Maketlar** (`mockups/*.dc.html`) — UI uchun manba; + tekshiruv skrinshotlari. Ilgari `RussianDesign/`. |

## ⚠️ 2026-07-17 — kurs o'zgarishi

Backend **C#/.NET 9** ga ko'chirildi; baza **Postgres qoldi va ma'lumoti saqlandi**;
frontend React+TS qoldi, lekin dizayn va kod to'liq yangi.

Shuning uchun:
- `02-ARCHITECTURE-V2.md` — **backend qismi eskirgan** (SQLAlchemy/Celery/Pydantic).
  Domen chegaralari g'oyasi kuchda; texnologiya → `07`.
- `05-ROADMAP.md` — **eskirgan**. Yangi fazalar → `08`.
- `03` va `04` — **kuchda** (dizayn tildan mustaqil).

## O'qish tartibi

- **Ega / strateg** → 01 → **08**
- **Dizayner** → 01 → 03 → 04 → 06
- **Backend** → 00 → **07** → **08**
- **Frontend** → 00 → **07 §7.11** → 03 → 04

## Bir jumlada qaror

> Mahsulot **«Govori»** brendi ostida qayta ishga tushiriladi; UI **Ovoz Design System** ustiga
> quriladi (bitta token manbai, light+dark, Tailwind v4 + CVA); backend **domenli modul monolit**ga
> ajratiladi; asosiy mahsulot farqi — **AI bilan jonli suhbat (roleplay) + fonema darajasidagi
> talaffuz mashqi + o'qituvchi uchun sinf-analitikasi**.
</content>
</invoke>
