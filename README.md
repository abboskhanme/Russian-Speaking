# Govori — govorim.uz

Russian‑speaking practice platform for Uzbek learners: record an answer, get AI
pronunciation + grading feedback, progress through modules, compete on the
leaderboard. Teachers run groups, assign work, and track a gradebook.

Rebuilt on **.NET 9** (backend) + **React 18 / Vite** (frontend). The design
system is **Ovoz DS**.

## Quick start (Docker only)

```bash
cp .env.example .env         # set SECRET_KEY (+ optional GOOGLE_CLIENT_ID / AI keys)
docker compose up -d --build
```

Open **http://localhost:8081**. Dev logins (all password `Parol123!`):
`student@govori.uz` · `teacher@govori.uz` · `admin@govori.uz`.

Full Docker guide: [`docs/09-DOCKER.md`](docs/09-DOCKER.md).

## Layout

```
backend-dotnet/   .NET 9 solution — Api · Worker · Contracts · Infrastructure (EF Core,
                  database-first) · Platform (Stt/Grader/Storage) · Realtime (Hangfire+SignalR)
                  · Modules/ (Identity, Catalog, Practice, Assessment, Classroom,
                  Engagement, Administration, Billing, Drills) · tests (Characterization/Unit/Integration/Arch)
frontend/         React + Vite SPA — src/{app,screens,widgets,shared,locales}
deploy/           nginx conf · Postgres seeds · backup/restore/domain scripts
docs/             00–09 — audit, product/architecture, design system, UX, roadmap,
                  .NET architecture (07), rewrite plan (08), Docker (09);
                  design/ — the mockups the UI is built from, + verification screenshots
tests/            characterization fixtures — frozen goldens owned by the C# tests
```

## Docs

- Architecture: [`docs/07-ARCHITECTURE-DOTNET.md`](docs/07-ARCHITECTURE-DOTNET.md)
- Rewrite plan / status: [`docs/08-REWRITE-PLAN.md`](docs/08-REWRITE-PLAN.md)
- Design system: [`docs/03-DESIGN-SYSTEM.md`](docs/03-DESIGN-SYSTEM.md)

> The prior Python/FastAPI stack was replaced by this rewrite; it remains in git
> history if ever needed.
