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
- [ ] "N ta guruhga qo'shilish so'rovi · Tasdiqlash kerak" (accent card) → the
  join-request model now EXISTS (Phase 2b, shipped). This card is just not wired
  into A1 yet — `GET /api/groups/requests` already returns what it needs.
- [ ] "Shu hafta sinf xatolari" (`родительный падеж · 12 o'quvchi qoqildi` +
  "Mashq ber") → needs error-pattern aggregation (Phase 6/D1).

**Verified on the running stack** (`aziz.karimov@govori.uz` — 1 group, 5
students, 21 queued): Obzor renders on real data in light + dark, desktop +
mobile; the FAB carries the live `21` badge; guards hold both ways (teacher
`/practice` → `/teacher`, student `/teacher` → `/`); unbuilt nav destinations
bounce back to Obzor.

## Phase 2 — Klasslar (A2 · A4 as one tabbed screen) ✅
Goal: the `Guruhlar | O'quvchilar` segmented screen.

**Backend** — no new endpoints; composed from three existing ones.
- [x] ✅ Guruhlar tab — `GET /api/groups`, `POST /api/groups` (mints the join code).
- [x] ✅ O'quvchilar tab — roster from `GET /api/groups/{id}` per group, scores
  merged in from `GET /api/reports/gradebook`.

**Frontend**
- [x] `ClassesScreen` + `ClassesPage` (`/teacher/classes`, `?tab=students`).
- [x] A2 group cards: `B2 · Группа Ойбек`, `6 o'quvchi` pill, `O'rtacha 81 · Kod`
  line, `Topshiriq berish` / `Ochish`, dashed `+ Yangi guruh` tile → create modal.
- [x] A4 student rows: avatar initials, name, `guruh · daraja`, score; search box;
  scored students sorted first.
- [x] i18n uz/ru/en.

**One honest deviation from the mockup, data-driven:**
- **No trend arrows** (`↑ 84` / `↓ 61` / `→ 72`). `GradebookRowResponse` carries
  only a lifetime `avg_band` — no second time window to compare against. The bare
  score ships now; the arrow needs the same backend work as the Obzor's trend
  card (Phase 6/D1). A student with no graded attempt reads **"baholanmagan"**
  rather than `0`, since the gradebook simply has no row for them.

**Verified**: create-group round-trip through the real UI (server minted code
`NMMEXJ`, card appeared, test group removed); both tabs render on real data in
light+dark, desktop+mobile; `Klasslar` nav now resolves to `/teacher/classes`;
student still blocked from it and all student routes error-free.

### Phase 2b — So'rovlar (join approval) ✅ — *product decision: approval, per the mockup*

**Backend**
- [x] 🔨 `group_join_requests` table (additive — `group_members` keeps its exact
  old meaning: a row there is still a REAL member, so every roster / gradebook /
  assignment query is untouched). Partial unique index allows only ONE pending
  row per (group, student), so a rejected student may ask again but can never
  queue twice. `status` is `text` + CHECK, not a native PG enum — a new
  `CREATE TYPE` would mean editing `GovoriDataSourceFactory` AND `GovoriDbContext`
  for one additive table's three states.
- [x] 🔨 `POST /api/groups/join` now files a REQUEST. Response is an additive
  superset of `GroupResponse` with `pending` — old fields unchanged, so the wire
  contract does not break.
- [x] 🔨 `GET /api/groups/requests` (owner-scoped), `POST …/{id}/approve`,
  `POST …/{id}/reject`, `GET /api/groups/requests/mine` (student's own).
- [x] Ownership: another teacher gets **404, not 403** — the existence of someone
  else's request is never leaked. Students get 403 on the queue outright.

**Frontend**
- [x] A3 So'rovlar tab with the live `· N` count; per-row Tasdiqlash / Rad, with
  the row's buttons disabled mid-decision so a double-tap cannot fire twice.
- [x] **Student waiting state** — Home gained a third state between "member" and
  "no group". Without it a join would re-render the join form and read as a
  silent failure, producing duplicate asks.

**Bug found and fixed during verification:** relative times ("2 soat oldin") were
built on `Intl.RelativeTimeFormat`, which looked right in Node. **Chromium ships a
reduced ICU**: `uz` passes `supportedLocalesOf` and reports `resolvedOptions()
.locale === "uz"`, but has no Uzbek relative-time data — it rendered `-2 h` and
fell back to English `"this minute"`. Since uz is the DEFAULT language that was
the main path. Replaced with `time.*` i18n keys, which also gets Russian's
one/few/many from the CLDR rules already in use. Don't reach for
`Intl.RelativeTimeFormat` here again.

**Verified**: 206/0 across all four suites (86 Unit · 35 Arch · 35 Characterization
· 50 Integration) against a scratch DB clone; migration applied to dev; live
round-trip in the browser — student asks → sees "So'rov yuborildi" (survives
reload) → teacher's queue shows `So'rovlar · 1` → approve → queue empties and the
student's Home shows the teacher block with the roster at 7. Test rows removed.

## Phase 3 — A5 Guruh detali · A6 O'quvchi profili · A7 A'zo qo'shish ✅
**Backend** — all additive; no new endpoints beyond one query param.
- [x] 🔨 **AI scores on `SubmissionResponse`** (`overall_band` + the four
  sub-skills). `Evaluation` already held them; the LIST projection just never
  surfaced them, so anything needing a score had to fetch `/detail` per attempt.
  That single gap is why the Obzor trend card, the A4 arrows and A6's whole
  content were blocked. `Include(s => s.Evaluation)` added to both read paths —
  without it the score silently reads `null`, i.e. "ungraded".
- [x] 🔨 `GET /api/submissions?student_id=` — a NARROWING filter applied after the
  role scoping, never instead of it: a teacher asking for a non-roster student
  gets an empty list, not that student's work.
- [x] 🔨 `GroupMemberResponse.joined_at` (was on `GroupMember.CreatedAt`, unprojected).
- [x] ✅ Group detail + roster, gradebook, assignments — already existed.

**Frontend**
- [x] A5 `TeacherGroupDetailScreen` (`/teacher/classes/:groupId`) — stat tiles,
  `+ Topshiriq berish` / `A'zo qo'shish`, "Faol topshiriqlar" progress rows
  (assignments folded BY QUESTION — the endpoint returns one row per student),
  roster → A6.
- [x] A6 `TeacherStudentProfileScreen` (`/teacher/students/:studentId`) —
  identity + meta, "Ko'nikmalar" bars, "So'nggi urinishlar" with score circles.
- [x] A7 `GroupInviteScreen` (`/teacher/classes/:groupId/invite`) — invite link +
  join code with copy, and that group's waiting students.
- [x] i18n uz/ru/en.

**Three honest omissions (no backing data — do NOT fake):**
- A5's **Davomat 92%** tile — no attendance model exists at all, so the tile row
  is two-up, not three-up.
- A5's **"Guruh xatolari"** card — no error-pattern aggregation (Phase 6/D1).
- A7's **`HAVOLA` / `KOD` source chips** — the invite link resolves to the same
  join-by-code flow, so every request has one provenance. A `HAVOLA` chip would
  be a guess presented as a fact.

**Two bugs found while verifying:**
1. **`Intl.DateTimeFormat` has no Uzbek month names in Chromium** — the same
   reduced-ICU trap as Phase 2b's relative times. `{month:"long"}` rendered
   `"2026 M07"` and `{month:"short"}` rendered `"M07 30"`; Node's full ICU formats
   both fine, so it only shows up in a browser. Month names now come from
   `time.month1…12` with a per-language order pattern (`time.dayMonthTime`,
   `time.monthYear`) → "1-iyul 00:00", "qo'shilgan iyul 2026".
   **Do not use `Intl.DateTimeFormat`/`Intl.RelativeTimeFormat` for uz here.**
2. **`dev-role.sh` did not move `assignments.teacher_id`** — so A5's "Faol
   topshiriqlar" came back empty even with 31 rows in the DB.
   `ListAssignmentsTeacherAsync` filters on who CREATED the assignment, not on the
   question's owner. Script fixed; both directions now move assignments too.

**Also**: `copyText` helper — `navigator.clipboard` is undefined outside a secure
context, and the invite screen is used over plain HTTP on a LAN address while
testing on a phone, so it falls back to a hidden textarea + `execCommand`.

**Verified**: 206/0 across all four suites; A5/A6/A7 on real data in light+dark
mobile; all 7 student routes error-free.

## Phase 4 — Navbat (B1 · B2 · B3) — the FAB destination ✅

**Backend** — additive.
- [x] 🔨 `GET /api/submissions?needs_review=true` — status `done` + `reviewed_at`
  null. `failed` is excluded on purpose: a pipeline failure is an ops problem, not
  a grading decision, and asks a teacher to judge an attempt never scored.
- [x] 🔨 `PATCH /api/submissions/{id}/review` — `TeacherBand` and/or
  `TeacherComment`, stamped with `ReviewedBy`/`ReviewedAt`. Both fields optional
  so "confirm the AI but add a note" and "override the score" are both
  expressible; **neither** is a 400 (an empty review would stamp `reviewed_at`,
  clear the queue row and record no decision). Non-roster teacher → 404, not 403.
- [x] 🔨 `AttemptDetailResponse` += `words[]` — parsed from
  `Transcript.WordTimestamps` (`{word,start,end,accuracy,error_type}`), which the
  STT provider has always written and nothing ever read out. This is what makes
  the word-by-word coloured transcript real rather than decorative.
- [x] 🔨 `AttemptDetailResponse` += `student_name` — the DTO was the student's own
  result shape, where their name is redundant; a teacher opening an attempt by
  direct link had nothing to identify it by.

**Frontend**
- [x] B1 `ReviewQueueScreen` (`/teacher/queue`) — the FAB's destination.
- [x] B2 `AttemptReviewScreen` (`/teacher/queue/:attemptId`) — audio, per-word
  transcript coloured AND underlined by accuracy (colour is never the only
  signal, docs/03 §3.3), AI scores, parsed corrections + feedback.
- [x] B3 manual grading as a full-size sheet: overall band slider + "Izoh
  o'quvchiga".
- [x] i18n uz/ru/en.

**Two mockup elements replaced rather than faked:**
- B1's `Ishonch past` / `Shikoyat` chips → **`Hammasi` / `Past ball`**. Neither
  original exists in the data: there is no AI-confidence value anywhere on
  `Evaluation`, and no complaint/flag model at all. A chip labelled "Ishonch past"
  would be sorting by a number we do not have. The band IS real, so the filter
  says `Past ball`.
- B3's three per-criterion sliders → **one overall band slider**, with the AI's
  per-criterion scores shown read-only (labelled as not editable). `submissions`
  carries a single `teacher_band`; making the criteria overridable needs three
  more columns plus a roll-up rule.

Also absent for want of data: B2's per-syllable pronunciation chips
(`ма 92 га 88`) and correction accept/reject — `Transcript.Pronunciation` holds
only aggregate scores, and there is no per-correction verdict model.

**Bugs found while verifying:**
1. `ReviewAsync` did not `Include(s => s.Question)`, but `TeacherDeniedAsync`
   compares `sub.Question.TeacherId` — so the endpoint 404'd for the rightful
   owner. Caught by the new integration test.
2. **`feedback` and `corrections` are JSON columns, not prose**, and were being
   rendered verbatim — a raw `{"summary": …}` blob on screen. This was ALSO live
   on the **student's** own result screen, so students were seeing it too. Fixed
   centrally: `parseFeedback` / `parseCorrections` in `app/adapters`, consumed by
   both the teacher's B2 and the student's `AttemptDetailScreen`.

**Behaviour pinned by a new test:** a teacher's band **overrides** the AI's
everywhere downstream — the gradebook reports 77.5 after review, not the
evaluation's 80. That is the point of a manual review, so it is asserted rather
than left implicit.

**Verified**: 206/0 across all four suites; full grade-an-attempt flow in the
browser (queue → detail → manual grade → saved, `reviewed_by` attributable in the
DB); student routes error-free with no raw JSON anywhere.

## Phase 5 — Kontent (C1 · C2 · C4 · C5)

**Audit result:** there is **no authoring API at all**. `Govori.Catalog` exposes
exactly ONE endpoint — `GET /api/blocks/student` — and nothing anywhere creates or
edits a module or a task. The `QuestionBlock` + `Question` ENTITIES do exist with
every field these screens need (name/topic/level/ru_style/visibility/
is_published/sort_order/cover_key; title/prompt_text/level/prep_time_sec/
answer_time_limit_sec/model_answer_text/instruction_text/block_id), so this is a
new HTTP surface over existing tables — **no migration**.

**Backend** (all new, teacher-scoped) ✅
- [x] 🔨 `GET /api/blocks` — the teacher's own modules + task counts.
- [x] 🔨 `POST /api/blocks` · `PATCH /api/blocks/{id}` — create / rename /
  publish↔draft.
- [x] 🔨 `GET /api/questions` (`?q=` search, `?block_id`, `?unassigned`) — powers
  both the Vazifalar tab and C5's library picker.
- [x] 🔨 `POST /api/questions` · `PATCH /api/questions/{id}` — create / edit /
  attach to a module / reorder / publish↔draft.

**Frontend** ✅
- [x] C1 `/teacher/content` — `Modullar | Vazifalar` tabs + "+ Yaratish".
- [x] C4 `/teacher/content/:blockId` module editor, with C5's library picker and
  C2's new-task sheet as full-size modals off it.
- [x] i18n uz/ru/en.

**Decisions worth keeping:**
- **New content starts as a DRAFT.** Both `POST` routes force
  `is_published = false`; publishing is a separate, explicit `PATCH`. Nothing
  reaches a student because a teacher happened to save a half-written task.
- **A draft's `student_count` is 0**, not the roster size — a draft reaches nobody,
  and "38 o'quvchi" on an unpublished module would be a lie.
- **The picker offers only UNATTACHED tasks** (`?unassigned=true`).
  `questions.block_id` is a single column, so a task belongs to at most one
  module; offering attached ones would invite a silent move out of another module.
- **Detach ≠ delete.** "Olib tashlash" clears `block_id` and the task returns to
  the library. This screen never deletes content.
- **`detach_block` is its own flag** because over JSON an absent `block_id` and an
  explicit `null` are indistinguishable — without it, "leave the module alone" and
  "remove from the module" would be the same request.
- **`PATCH` is partial**: an absent field is left alone, and a blank string clears
  it. Publishing is `{ is_published: true }` with no risk of blanking the name.
  Blanking a `name`/`title` is refused outright — an unnamed module is
  unrecoverable in the list.

**A third `dev-role.sh` gap found and fixed**: it moved `groups`, `questions` and
`assignments` but not `question_blocks` or `topics`, so Kontent showed 0 modules
while the questions inside them were visible. The script now moves every table
carrying a `teacher_id`, with the enumerating query recorded in a comment so the
next column added cannot be missed the same way.

**Verified**: 207/0 across all four suites (Integration 50 → 51 with the new
ownership test); the full authoring flow in the browser — create draft module →
rename → add a task via C2 → C5 picker correctly empty when everything is
attached; student routes error-free. Test content removed.

### Deferred — C3 · C6 Ssenariylar (AI roleplay) — *needs a product decision*
There is **no scenario table** anywhere in the schema, and the student's `/chat`
scenario grid is **static frontend data** (`screens/conversation`) that the app
never fetches. So teacher-authored scenarios are not a wiring job — they need a
new table, an authoring surface, AND the student hub rewired to read from the API.

**Decision needed first:** do teacher-authored scenarios REPLACE the curated
static set, or supplement it (curated ones stay, teachers add their own)? That
answer changes the schema (does a scenario need an owner? a visibility?) and what
students see, so it should not be guessed at.

**Media upload** (C2's "Rasm yoki video yuklash", marked optional in the mockup) is
also deferred: `Question.MediaKey` and object storage both exist, but there is no
multipart upload endpoint for it yet.

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

## Testing the teacher panel on a real phone
Telegram OTP proves phone ownership via a contact share, so you **cannot** sign
in as a demo teacher from your own Telegram. Two ways in:

1. **Your own number, teacher role** — `./dev-role.sh teacher <your-phone>` flips
   your account to teacher and lends it `teacher1@demo.uz`'s groups **and**
   questions (both are needed: a teacher only sees answers to their OWN
   questions AND their OWN roster). `./dev-role.sh student <your-phone>` undoes
   it exactly. Reload the app — no re-login; `/api/auth/me` re-reads the role.
2. **A demo teacher account, dev OTP** — start the API with the bot token blank
   so `000000` is accepted, then log in as `+998901112201` … `+998901112205`:
   `TELEGRAM_BOT_TOKEN= TELEGRAM_BOT_USERNAME= docker compose up -d --no-deps --force-recreate api`
   Restore real Telegram OTP with the same command minus the two env overrides.
   No file is edited — shell env just outranks `.env`.

From a phone, reach the local stack at `http://<mac-lan-ip>:8081` (same Wi-Fi);
the frontend calls `/api` relatively and nginx proxies it, so there is no CORS or
host config. Prod (`govorim.uz`) does **not** have the teacher panel yet.

> Seed-data wart: several demo accounts share phone numbers (e.g.
> `+998901112201` is on both `teacher1@demo.uz` and `aziz.karimov@govori.uz`).
> Login resolves the OLDEST match. Worth cleaning up.

## When everything is done
- [ ] Delete this file (`TEACHER-PANEL-PLAN.md`) and `dev-role.sh`.
