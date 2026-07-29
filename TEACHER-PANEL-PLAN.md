# Teacher Panel — Build Plan & Progress Tracker

> **Temporary file.** Delete once the teacher panel is complete. Update the
> checkboxes as we finish each step. We work phase-by-phase, top to bottom.

## Source of truth
- **Design:** `RussianDesign/Govori/Govorim - Teacher.dc.html` — the ONLY design
  reference for these screens, plus `docs/04-UX-FLOWS.md` (teacher flows).
- **The teacher panel is its own product, not a re-skinned student panel.** Its
  design, its nav, its screens are all separate; only the underlying *data*
  crosses over (the same submissions/groups/scores the students produce). Never
  start a teacher screen from a student screen's layout, nav model, or mascot.
  `shared/ui` primitives + tokens ARE shared — that's infrastructure, not layout.

## The teacher nav (from the mockup's bottom bar)
`Bosh · Klasslar · [Navbat — raised centre FAB, badged with the pending count] ·
Kontent · Analitika`

There is **no Profil item** — the header avatar on Bosh is the profile entry.
The centre FAB is the *grading queue*, the teacher's counterpart to the student's
mic FAB.

## Mockup screen map (19 screens, 4 boards)
| Board | Screens |
| --- | --- |
| **A · Bosh + Klasslar** | A1 Obzor · A2 Guruhlar · A3 Qo'shilish so'rovlari · A4 O'quvchilar · A5 Guruh detali · A6 O'quvchi profili · A7 A'zo qo'shish (havola + kod) |
| **B · Navbat (tekshirish)** | B1 Tekshirish navbati · B2 Javob detali (so'zma-so'z) · B3 Qo'lda baholash + feedback |
| **C · Kontent** | C1 Modullar · C2 Vazifa yaratish · C3 Ssenariylar (roleplay) · C4 Modul yaratish · C5 Vazifa tanlash (kutubxona) · C6 Ssenariy yaratish (AI roleplay) |
| **D · Analitika** | D1 Insaytlar · D2 Jurnal (baholar) · D3 Topshiriq berish (bulk assign) |

## Conventions (every phase)
- Presentational screens are prop-driven (`screens/teacher/*`); pages fetch
  (`app/routes/*`); routes in `App.tsx` behind role routing.
- Reuse `shared/ui` + tokens; full-width; light/dark; i18n under `teacher.*`
  (uz/ru/en) — no hardcoded copy.
- Per-request scoping stays teacher-owned (roster/ownership checks on the server).
- **Never fake data.** If a mockup card has no backend behind it, leave it out and
  record it here as a follow-up rather than shipping an invented number.
- After each phase: `tsc` clean → rebuild frontend (and API when backend
  changed, via the publish→runtime-image path) → screenshot-verify → tick boxes.

## Backend readiness legend
✅ ready · ⚠️ verify/adapt · 🔨 build

---

## Phase 1 — Teacher shell + A1 Obzor
Goal: a teacher who logs in lands on the teacher app, with the teacher's OWN nav
and the mockup's Obzor screen ("bugun kimga yordam kerak"), on real data.

**Backend**
- [x] ⚠️ No new endpoint — the Obzor composes from `GET /api/groups` (teacher
  list) + `GET /api/submissions` (roster attempts, teacher-scoped server-side).

**Frontend**
- [x] Role routing in `App.tsx` / `app/guards.tsx`: `RoleHome` sends teacher+admin
  to `/teacher`, `RequireRole` keeps each subtree to its own role.
- [x] Teacher nav rebuilt to the mockup — `Bosh · Klasslar · Navbat(FAB) ·
  Kontent · Analitika`, replacing the student-shaped
  `Boshqaruv · Guruhlar · Topshiriqlar · Jurnal · Profil`. New `QueueIcon` +
  `ContentIcon`; pending count rides the FAB badge.
- [x] `TeacherDashboardScreen` rebuilt to **A1 Obzor**: greeting + avatar-initials
  header (no student mascot, no header action buttons) → "E'tibor talab qiladi"
  alert cards → 3 stat tiles at the bottom (Guruh · O'quvchi · Navbatda).
- [x] `TeacherDashboardPage` wired to real fetches, `allSettled` fault-tolerant.
- [x] i18n `teacher.*` + the new teacher `nav.*` keys in uz/ru/en.

**Deferred from A1 — no backend behind them, and a faked count on a triage
screen is worse than a missing card:**
- [ ] "N o'quvchi X punkt tushdi · Profilni ko'rish" (warn card) →
  `SubmissionResponse` carries **no AI score** (only `teacher_band`), and
  `GradebookRowResponse` exposes only a lifetime `AvgBand`/`BestBand`. A trend
  needs two time windows — so this needs a backend change (Phase 6/D1).
- [ ] "N ta guruhga qo'shilish so'rovi · Tasdiqlash kerak" (accent card) → needs
  the join-request model (Phase 2b).
- [ ] "Shu hafta sinf xatolari" (`родительный падеж · 12 o'quvchi qoqildi` +
  "Mashq ber") → needs error-pattern aggregation (Phase 6/D1).

**Verified on the running stack** (`aziz.karimov@govori.uz` — 1 group, 5
students, 21 queued): Obzor renders on real data in light + dark, desktop +
mobile; the FAB carries the live `21` badge; guards hold both ways (teacher
`/practice` → `/teacher`, student `/teacher` → `/`); unbuilt nav destinations
bounce back to Obzor.

## Phase 2 — Klasslar (A2 · A3 · A4 as one tabbed screen)
Goal: the `Guruhlar | So'rovlar · N | O'quvchilar` segmented screen.

**Backend**
- [ ] ✅ Guruhlar tab — `GET /api/groups`, `POST /api/groups` (returns join code).
- [ ] 🔨 So'rovlar tab — pending-membership model + `approve`/`reject`. Today
  students join **instantly** via code; this adds an approval step.
      *Decision needed: keep instant-join, or add approval?*
- [ ] ⚠️ O'quvchilar tab — a flat "all my students" list; may need a small
  endpoint or a client-side merge of group rosters. Needs the per-student trend
  arrow (`↑ 84` / `↓ 61` / `→ 72`) the mockup shows.

**Frontend**
- [ ] `ClassesScreen` + page (`/teacher/classes`) with the 3 tabs.
- [ ] A2 group cards: `B1 · Kechki-3`, `18 o'quvchi` pill, schedule + avg line,
  `Topshiriq berish` / `Ochish` actions, `+ Yangi guruh` dashed tile.
- [ ] A4 student rows: avatar, name, `guruh · daraja`, trend score.
- [ ] i18n.

## Phase 3 — A5 Guruh detali · A6 O'quvchi profili · A7 A'zo qo'shish
**Backend**
- [ ] ✅ Group detail + roster — `GET /api/groups/{id}`.
- [ ] ✅ A teacher may read their roster students' attempts —
  `GET /api/submissions` + `GET /api/submissions/{id}/detail`.
- [ ] ⚠️ A5 stats (O'quvchi · O'rtacha · Davomat) + active-assignment progress
  bars (`11/18`) — check what the group detail already returns.

**Frontend**
- [ ] `TeacherGroupDetailScreen` (`/teacher/classes/:id`): 3 stat tiles,
  `+ Topshiriq berish`, "Faol topshiriqlar" progress rows, "Guruh xatolari".
- [ ] `TeacherStudentProfileScreen` (`/teacher/students/:id`).
- [ ] A7 invite: share link + join code.
- [ ] i18n.

## Phase 4 — Navbat (B1 · B2 · B3) — the FAB destination
Goal: AI auto-OKs confident grades; only attempts needing attention reach here.

**Backend**
- [ ] 🔨 Review-queue filter — submissions needing attention (AI low-confidence /
  ungraded); a new query param or endpoint.
- [ ] 🔨 **Teacher review write endpoint** — set `TeacherBand` + `TeacherComment`
  (+ `ReviewedBy`/`ReviewedAt`). Fields exist on the entity; the write endpoint
  does **not** — build `PATCH /api/submissions/{id}/review` (teacher/admin,
  roster-scoped).

**Frontend**
- [ ] B1 `ReviewQueueScreen` (`/teacher/queue`).
- [ ] B2 answer detail — audio + word-by-word transcript + AI scores.
- [ ] B3 manual band + "Izoh o'quvchiga" feedback.
- [ ] i18n.

## Phase 5 — Kontent (C1–C6)
- [ ] ⚠️ Audit what the catalog/authoring API already exposes vs. what C2/C4/C5/C6
  need (module create, task create, task library picker, AI roleplay scenario).
- [ ] C1 Modullar · C3 Ssenariylar lists (`/teacher/content`).
- [ ] C4 Modul yaratish · C2 Vazifa yaratish · C5 Vazifa tanlash · C6 Ssenariy
  yaratish.
- [ ] i18n.

## Phase 6 — Analitika (D1 · D2 · D3)
- [ ] ✅ Gradebook — `GET /api/reports/gradebook?group_id`.
- [ ] 🔨 D1 Insaytlar KPIs: hero class-average chart, 2×2 stat tiles (Faol
  o'quvchi `41/48` · Topshiriq bajarilishi `78%` · Haftalik mashq `312 daq` · Bu
  hafta baholandi `94 javob`), skill distribution, class error patterns.
- [ ] D2 Jurnal — the scores table.
- [ ] D3 Topshiriq berish — bulk assign (`POST /api/assignments` ✅,
  `POST /api/assignments/module` ✅).
- [ ] i18n.

## Phase 7 — Teacher profile
- [ ] Reached from the A1 header avatar (there is no Profil nav item): name,
  groups, settings (language/theme/notifications), logout.
- [ ] i18n.

---

## Cross-cutting checklist (do throughout)
- [ ] Teacher i18n namespace `teacher.*` complete in uz/ru/en.
- [ ] Backend tests stay green after each backend change (206 baseline; new
  endpoints get integration coverage).
- [ ] Dark mode + mobile (bottom nav) verified per screen.
- [ ] Seed/dev data: `teacher@govori.uz` currently owns **no groups** — use a demo
  teacher with real data (e.g. `aziz.karimov@govori.uz`: 1 group, 5 students, 21
  visible submissions) or seed groups onto the dev teacher.

## When everything is done
- [ ] Delete this file (`TEACHER-PANEL-PLAN.md`).
