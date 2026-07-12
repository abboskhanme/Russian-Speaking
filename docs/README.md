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
| 05 | [`05-ROADMAP.md`](./05-ROADMAP.md) | Fazalar, ketma-ketlik, Definition of Done, xavflar. |
| 06 | [`06-CLAUDE-DESIGN-PROMPT.md`](./06-CLAUDE-DESIGN-PROMPT.md) | **Claude Design uchun tayyor prompt** (copy-paste). |

## O'qish tartibi

- **Ega / strateg** → 01 → 05
- **Dizayner** → 01 → 03 → 04 → 06
- **Backend** → 00 → 02 → 05
- **Frontend** → 00 → 02 → 03 → 04

## Bir jumlada qaror

> Mahsulot **«Govori»** brendi ostida qayta ishga tushiriladi; UI **Ovoz Design System** ustiga
> quriladi (bitta token manbai, light+dark, Tailwind v4 + CVA); backend **domenli modul monolit**ga
> ajratiladi; asosiy mahsulot farqi — **AI bilan jonli suhbat (roleplay) + fonema darajasidagi
> talaffuz mashqi + o'qituvchi uchun sinf-analitikasi**.
</content>
</invoke>
