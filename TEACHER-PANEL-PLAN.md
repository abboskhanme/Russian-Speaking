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

**Deferred from A1 — a faked count on a triage screen is worse than a missing
card. ALL THREE SHIPPED in Phase 6b (below); the Obzor now renders all four:**
- [x] "N o'quvchi X punkt tushdi" (warn) ← `GradebookRowResponse.trend_delta`.
- [x] "N ta guruhga qo'shilish so'rovi · Tasdiqlash kerak" (accent) ←
  `GET /api/groups/requests` (the model has existed since Phase 2b).
- [x] "Shu hafta sinf xatosi" (warn) ← `insights.errors[0]`.

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

**One honest deviation from the mockup, data-driven — SINCE CLOSED in Phase 6b:**
- ~~**No trend arrows** (`↑ 84` / `↓ 61` / `→ 72`)~~ — `GradebookRowResponse`
  carried only a lifetime `avg_band`, with no second window to compare against.
  `trend_delta` supplied that in Phase 6b and the arrows now ship. A student with
  no graded attempt still reads **"baholanmagan"** rather than `0`, since the
  gradebook simply has no row for them.

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

**Audit result:** every D1 KPI already had a column behind it — the numbers were
simply never projected. `Evaluation` carries the four sub-skills, `Submission`
carries `audio_duration_sec` + `reviewed_at`, `assignments` carries completion,
and `evaluations.corrections` carries a `type` per correction. So Phase 6's
backend is **one composed read over existing rows — no migration**.

**Backend** ✅ — all additive.
- [x] 🔨 `GET /api/reports/insights?group_id=` — the whole D1 payload in one
  read, scoped exactly like the gradebook. The group filter **intersects** with
  the caller's roster rather than replacing it, so a teacher passing another
  teacher's `group_id` learns nothing about it — **not even its size**.
- [x] 🔨 `GradebookRowResponse` += `fluency/grammar/pronunciation/lexical`,
  APPENDED (wire shape untouched), averaged over the SAME recent window
  `avg_band` uses so a row's headline and its skills describe one set of answers.
- [x] ✅ Gradebook itself — `GET /api/reports/gradebook?group_id` already existed.

**Frontend** ✅
- [x] D1 Insaytlar (`/teacher/analytics`): hero class-average + CEFR badge +
  3-month trend, 2×2 stat tiles, skill distribution, weekly activity, class error
  patterns. The nav item already pointed here — the PATH had no route, so it fell
  through to the `*` catch-all and bounced to Obzor.
- [x] D2 Jurnal (`?tab=grades`) — the scores table with the new per-skill columns,
  plus CSV export built client-side (UTF-8 BOM so Excel reads the Cyrillic and
  Uzbek names). One `?group=` param drives BOTH fetches, so an exported CSV always
  matches the table the teacher filtered.
- [x] D3 Topshiriq berish (`/teacher/assign`, `?group=` preselects) — task OR
  module, one group, optional deadline. The A2 group cards and the A5 group detail
  were ALREADY navigating here; only the route was missing.
- [x] i18n uz/ru/en.

**Decisions worth keeping:**
- **Two different class averages ship side by side, on purpose.** `class_avg` is
  the mean of the per-student rolling averages — literally the mean of the
  `avg_band` values D2's table prints, so the headline can never disagree with
  the table under it. The trend points are per-SUBMISSION means: averaging
  students would let a month in which one student practised speak for the class.
- **`trend_delta` compares the two most recent months that BOTH have data**, not
  "this month minus last month". The naive rule is blank for the first days of
  every month — exactly when a teacher opens the screen. Caught on real data:
  it read `null` on 7 Aug and now reports `-4.1` (July 78.44 vs June 82.54).
- **Error types stay VERBATIM on the wire.** `corrections[].type` is an
  open-ended vocabulary the grader writes (today's rows hold `word_order` and
  `relevance`); the client maps known ones to labels and falls back to the raw
  string, so a type nobody has seen yet still appears instead of vanishing into
  an "other" pile. Parsed in C#, not SQL — the set is already roster-bounded.
- **Fixed-length series.** `trend` is always 3 and `week` always 7, so the charts
  keep a fixed axis; a month with nothing graded is `null` (a GAP in the line),
  never `0` (a plunge).
- **Rolling 7×24h windows, not calendar weeks** — a calendar week makes Monday
  morning report a near-empty class, which reads as an outage, not a fresh week.

- **D3 reports what the SERVER did, not what the UI hoped.** The assignment count
  comes from the response array: the server drops targets outside the teacher's
  roster (the S1 filter) and skips tasks a student already has, so "6 o'quvchiga
  topshirish" legitimately produced **4** rows in the live test. Saying so beats
  hiding it. Only PUBLISHED tasks/modules are offered — a draft reaches nobody,
  and an empty module 400s server-side anyway.

**Omitted for want of data (do NOT fake):**
- D1's **"Mashq ber"** button on each error row — nothing maps an error type to a
  task, so the button would have nowhere honest to go. Same for the **"Hammasi"**
  link beside that heading: the endpoint returns the top 5 and there is no
  all-errors destination.
- D3's **"Urinish · 3 ta"** (max attempts) — `assignments` has no attempts column
  and nothing in the pipeline enforces a limit, so the control would promise a
  rule the server does not keep.

**Two bugs found while verifying (both only visible in a real browser):**
1. The hero rendered the LEVEL LABEL at display size — "o'rta-yuqori" wrapped to
   two lines and shoved the band off the card. The CEFR CODE is the headline;
   the label is secondary text beside the score.
2. D2's table overflowed a 390px phone, and since the wrap scrolls sideways,
   **Ball** — the column the teacher came for — sat off-screen until they thought
   to swipe. Tightened gutters under 430px fit all four columns.

**Also fixed here (pre-existing, whole panel):** all 8 teacher stylesheets used
`var(--focus)` and `var(--motion-fast)`, and NEITHER is defined in `tokens.css`
(the real names are `--focus-ring` / `--m-fast`, and `--m-fast` already bundles
its easing). Every one of those declarations was invalid at computed-value time,
so the teacher panel had **no visible focus ring for keyboard users** and no hover
transitions. 28 declarations repaired.

**Verified**: 207/0 across all four suites (86 Unit · 35 Arch · 35 Characterization
· 51 Integration) against a scratch DB clone; the insights endpoint live on real
data (`class_avg 81.4 · B2`, June 82.54 → July 78.44, `word_order` 23× across 5
students) and the foreign-group guard live (all null, `total_students 0`).

**Screens verified in a REAL browser** — the Claude-in-Chrome extension is not
connected in this environment, so the pass ran headless Chromium inside
`govori-net` (hitting `http://govori-web` exactly as a phone would, /api proxied
by the same nginx): 16 screenshots = D1 · D2 · D3 · A1 × mobile 390×844 +
desktop × light + dark. No route bounced, no console error, no raw JSON on screen.
The D3 WRITE path was driven as a real click-through (open with `?group=` →
picker → module → submit): the screen reported "4 ta topshiriq berildi" and the
DB moved 31 → 35, matching exactly. Test rows removed.

**Verification wart worth knowing:** the dev seed writes ABSOLUTE timestamps, so
the fixture ages — as of Aug 2026 the newest submission anywhere is ~5 weeks old
and every "this week" tile reads 0 legitimately. That is correct behaviour, not a
bug, but it means the populated state of the weekly tiles/chart can only be seen
by shifting a slice of `submissions.created_at` forward and shifting it back.

## Phase 6b — A1's deferred cards + A4's trend arrows ✅

It was scoped as pure frontend and was not: the mockup's card names STUDENTS
("N o'quvchi ball tushdi") and `insights.trend_delta` is a CLASS figure, which
can never name anyone. So one additive backend field came first — and it closed
Phase 2's deferred A4 arrows in the same stroke.

**Backend** ✅ — additive, no migration.
- [x] 🔨 `ClassroomScoring.TrendDelta` + `GradebookRowResponse.trend_delta`
  (appended): the mean of the NEWER half of a student's recent graded answers
  minus the OLDER half. The window is SPLIT rather than "last N vs the N before"
  because a fixed split needs twice `RecentWindow` answers before it says
  anything, and students here have far fewer — splitting what they do have gives
  a student with six answers a real 3-vs-3 comparison. `null` under four graded
  answers, and on an odd count the MIDDLE answer is dropped rather than counted
  on both sides (which would pull both means together and flatten every trend).

**Frontend** ✅
- [x] A1 renders all four attention cards, each behind its own fetch so a failing
  aggregate costs one card, not the triage screen.
- [x] A4 roster shows the mockup's `↑ 84 / ↓ 61 / → 72` arrows.
- [x] i18n uz/ru/en.

**Decisions worth keeping:**
- **A drop card that fires every morning is one a teacher learns to ignore.** The
  card counts only students at or below **−5 points**, and the arrow treats
  anything inside **±2** as flat.
- **Unknown ≠ flat.** With under four graded answers there is no direction, so the
  row shows NO arrow — a `→` there would claim a plateau nobody measured. Seen
  live: the student with 3 attempts has no arrow while the five with 5 do.
- **The headline quotes the STEEPEST fall**, not the mean of the fallers — the
  card exists to surface the worst case first.
- **The hint matches where the tap goes**: "Profilni ko'rish" only when there is
  exactly ONE faller to open; several land on the roster and the card says so.

**Verified**: 213/0 across all four suites (92 Unit — 6 new trend tests · 35 Arch ·
35 Characterization · 51 Integration); `trend_delta` live on real data (5-attempt
students get a delta, the 3-attempt student is `null`); 12 screenshots of A1 · A3 ·
A4 in light+dark, mobile+desktop. The join-request card was proven by filing a
REAL request through the student API, screenshotting all four cards, then removing
it — a card nobody ever sees fire is not verified.

## Phase 7 — Teacher profile ✅

**This is the ONE teacher screen with no mockup.** `Govorim - Teacher.dc.html` has
no profile board at all — the only "Profil" in it is the A1 drop card's *"Profilni
ko'rish"*, which points at a STUDENT profile (A6). So the layout is the teacher
panel's own idiom, not the student profile re-skinned. The shared CONTROLS
(`ThemeToggle`) are reused because they are infrastructure; the layout is not.

- [x] `/teacher/profile` — identity card (name · role · joined · phone),
  "Guruhlarim" with member counts → A5, settings, sign out. Frontend only; the
  account comes from the auth context and the groups from `GET /api/groups`.
- [x] The A1 header avatar has navigated here since Phase 1; until this route
  existed the path fell through to the `*` catch-all and bounced back to Obzor.
- [x] i18n uz/ru/en.

**Omitted for want of data:** the **notifications toggle**. There is no
notification-preference column and no endpoint behind one, so the switch would
forget the teacher's choice on every reload — a control that silently does
nothing is worse than an absent one. (The student profile ships one as
session-local; duplicating that into a second panel would double the lie.)

**Follow-up worth doing — `users.preferred_language` EXISTS and nothing writes
it.** The column is there (`varchar(8) NOT NULL DEFAULT 'uz'`), but
`UpdateProfileArgs` does not expose it and the i18n bootstrap reads only
`localStorage`. So a language choice does not follow a user to another device.
Wiring it touches the shared Identity profile path, i.e. students too, so it was
not folded into a teacher-profile change.

**Verified**: built and deployed; 4 screenshots (mobile + desktop × light + dark).
Both interactive controls driven for real in a browser — the language switch
turns "Profil" into "Профиль", moves the radio state, **and survives a reload**;
sign out clears both tokens and lands on `/login`. The nav FAB's queue badge is
fetched here too: it is on every other teacher screen, so dropping it on this one
would read as "the queue emptied" rather than "this page didn't ask".

## Guard added — `npm run check:tokens`
`var(--nope)` is not an error anywhere in the toolchain: the declaration is
invalid at computed-value time and the property silently falls back. Nothing
warns — not the console, not the build, not eslint. That cost this panel its
entire keyboard focus ring for five phases without anyone noticing.

`frontend/scripts/check-tokens.mjs` now fails the build on any `var(--x)` with no
definition and no explicit fallback. It found `--motion-slow` still live in two
screens after the first sweep. A `var(--x, 28px)` with a real fallback is a
deliberate default and is not reported.

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
Every phase (1 · 2 · 2b · 3 · 4 · 5 · 6 · 6b · 7) is shipped. What is left is NOT
build-out — it is one product decision and a short list of follow-ups, so the file
stays until those are closed.

**Blocked on a product decision (see Phase 5's deferred section):**
- [ ] C3 · C6 Ssenariylar. Do teacher-authored scenarios REPLACE the curated
  static set or supplement it? The answer changes the schema (owner? visibility?)
  and what students see, so it must not be guessed.

**Follow-ups, in rough value order:**
- [ ] Wire `users.preferred_language` so a language choice follows the user across
  devices (touches the shared Identity path — students too).
- [ ] Notification preferences: a column + endpoint, then the Phase 7 toggle.
- [ ] Per-student trend on A6 (the profile shows skills, not direction).
- [ ] Media upload for C2 (`Question.MediaKey` + storage exist; no multipart
  endpoint).
- [ ] Attempt limits on assignments (D3's omitted "Urinish"), if the product
  wants them.
- [ ] Seed data writes ABSOLUTE timestamps, so the dev fixture ages out of every
  "this week" window. Regenerate relative to `now()`.
- [ ] Clean the duplicate demo phone numbers (login resolves the OLDEST match).

- [ ] Delete this file (`TEACHER-PANEL-PLAN.md`) and `dev-role.sh`.
