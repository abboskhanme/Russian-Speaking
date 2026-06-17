# RusSpeak — Master Upgrade Plan

> Status: planned 2026-06-12. Based on full codebase audit (done) + deep research on
> world-class speaking apps (workflow `wf_1c018537-e8b`; merge findings when available).
> Work phases in order; each phase is shippable on its own.

## Current state (audit summary)

- MVP ~85% done: auth (email+Google, 3 roles), questions/topics, audio submission via
  presigned S3, Azure STT + pronunciation assessment (just migrated off Whisper),
  Gemini band scoring (RU+UZ feedback), groups/assignments, gradebook+CSV, XP/streaks/
  leaderboard/spaced-repetition, freemium 3-attempt gate.
- Production readiness ~40%. Backend 6.5/10, frontend 7/10, devops 5/10.

## Phase 1 — Hardening — ✅ DONE & VERIFIED 2026-06-13 (image builds, 10/10 tests pass, migrations apply)

1. ✅ **Pagination** — submissions (limit/offset), leaderboard SQL-ranked+capped, students search+paginated. leaderboard, submissions, users, gradebook. Cursor-based for
   leaderboard. Files: `api/v1/engagement.py`, `submissions.py`, `users.py`, `reports.py`.
2. ✅ **N+1 fixes** — `selectinload` in `_group_detail()` (groups.py), `list_submissions()`,
   `create_assignments()`.
3. ✅ **Rate limiting** — custom redis limiter (app/core/ratelimit.py): `/auth/login` 10/5min/IP, submission
   create, model-answer generation.
4. ✅ **Frontend error boundary** + 404 NotFound page (i18n uz/ru/en) + 404 page + retry buttons on failed queries.
5. ✅ **Result-page polling** (already existed — audit was wrong) — poll `GET /submissions/{id}` every 2s w/ backoff until done.
6. ✅ **Stuck-submission recovery** — beat task fail_stuck_submissions (worker now runs -B), retry_backoff, soft_time_limit=270 — Celery: soft time limit, retry w/ backoff on transient
   STT/LLM errors, periodic task to fail submissions stuck "processing" > 15 min.
7. ✅ **Circuit breaker** — app/core/breaker.py wraps Azure + Gemini (fail-fast, auto-recover) (pybreaker) around Gemini + Azure calls.
8. ✅ **Soft deletes** — questions.is_deleted (migration b2c3d4e5f6a7); delete now soft, lists filtered — `is_deleted` on questions/topics/groups; stop cascade data loss.
9. ✅ **Input limits** — audio 25MB cap + ffmpeg 60s timeout + schema length caps (title/prompt/feedback/model_answer) — max lengths on title/prompt/feedback; audio file size cap in worker.
10. ✅ **Tests** — backend/tests/test_units.py (15 tests: XP, STT parse/aggregate/mode, breaker) + conftest.py so dev tests use live mounted source not stale install — pytest skeleton: auth flows, role permissions, submission pipeline
    (mock Azure/Gemini), gamification rules. Target the critical paths, not 100%.

## Phase 2 — Design system & cozy UI (~1 week) — STATUS 2026-06-13: partly done

NOTE: design tokens already mature (index.css @theme: brand palette, success/warn/
danger, ios-* remapped, Nunito cozy font, animations, Mascot). Audit overstated the
"hardcoded colors" problem. Remaining hardcoded hex: ~9 spots (low priority).


Goal: cozy, cute-but-not-childish, consistent. Keep FULL-WIDTH page rule (never
mx-auto max-w-* on page roots).

1. **Design tokens** — move colors to CSS variables / tailwind theme (no hardcoded
   `#9b7bff` in components); unify border radii (one scale), shadows, spacing.
2. **Component library** — Button, Card, Badge, Modal (full-height on mobile), Input,
   Skeleton, EmptyState, Toast — in `frontend/src/components/ui.tsx` (extend existing).
3. **Loading skeletons** everywhere (replace full-page spinners). NOTE: result-page
   processing state already cozy (Mascot+spinner); lower priority than audit implied.
4. **Mascot/illustration accents** — friendly empty states, celebration on submission
   scored (confetti, gentle), streak flame, level-up moments. Subtle, not ridiculous.
5. ✅(partly) **Score reveal UX** — DONE: strengths now lead before corrections;
   corrections capped at 3 with "show all (N)" toggle (research: keep feedback short);
   gentle one-shot confetti (Celebrate, pure CSS) when a student's score first reveals.
   TODO: animated band count-up.
6. **Dark mode** (optional, tokens make it cheap).
7. **A11y pass** — aria-labels, focus states, icon+color (not color-only) status,
   contrast fixes.
8. **Mobile polish** — gradebook table horizontal scroll, recorder canvas on narrow
   screens, active:scale press feedback, full-height modals.

## Phase 3 — Features that close the gap with top apps (~2-3 weeks)

Pending research merge; high-confidence items:

1. **Badges/achievements backend** — frontend cards already exist with no backend.
   Achievement model + award rules (first answer, 7-day streak, band milestones,
   N reviews done, etc.).
2. **Practice modes beyond Q&A**:
   - ✅ Listen-and-repeat / SHADOWING — COMPLETE & VERIFIED (migration applies,
     15 backend tests pass, frontend build succeeds). Flow: /shadowing page → curated
     RU phrases by level → browser TTS (Web Speech API, ru-RU, no backend cost) →
     record → /submissions/shadow → scripted Azure assessment (reference_text) →
     per-word PronunciationCard result. Pronunciation-only: no LLM, no academic band
     (kept out of gradebook/freemium); small fixed practice XP (award_practice).
     Submission.question_id now nullable + reference_text col (migration c3d4e5f6a7b8).
   - TODO: picture description (topic images exist), mistake-replay drill UI.
   - Picture description (topic images already exist — reuse).
   - Mistake replay: drill past corrections (spaced-repetition items already scheduled —
     build the actual drill UI; currently review completion isn't validated).
3. **Weekly challenges** — time-limited goals (e.g. 5 answers this week → bonus XP).
4. **Teacher quality-of-life** — ✅ question duplication (clone as draft, endpoint +
   table button + i18n); ✅ student search (users list); TODO: bulk assignment,
   gradebook trend charts.
5. ✅ **Per-word pronunciation drill-down** — DONE. SubmissionResult shows a
   PronunciationCard: each word colored green/yellow/pink by Azure accuracy, tappable
   for its score, sub-score chips (accuracy/fluency/completeness/prosody), legend.
   Backend TranscriptOut + frontend types expose `pronunciation`. (TODO: tap→hear word audio)
6. **Overall band weighting** — fold pronunciation_score into overall_band.

## Phase 4 — Production ops — ✅ DONE & VERIFIED 2026-06-13 (all 7 services healthy)

1. ✅ Healthchecks — backend (HTTP /health), worker (celery ping), frontend (wget),
   all reach (healthy). Added /health/ready (DB readiness → 503 if down).
   nginx ingress + HTTPS: nginx/nginx.conf + frontend/Dockerfile.prod (multi-stage
   build→nginx) + docker-compose.prod.yml (validated).
2. ✅ Structured JSON logging (app/core/logging.py, no dep) + Sentry gated on
   SENTRY_DSN (app/core/observability.py, sentry-sdk dep). Prometheus metrics:
   deferred (logging+Sentry cover errors; metrics can come later).
3. ✅ Postgres backups — `backup` service: hourly… daily pg_dump→gzip to ./backups,
   7-day retention. VERIFIED wrote a real 34KB dump. (MinIO mirror: documented option.)
4. ✅ CI — .github/workflows/ci.yml: ruff + pytest (backend), tsc + build (frontend).
   Fixed 2 pre-existing ruff errors so CI is green.
5. ✅ Orphan-upload cleanup beat task (hourly) — VERIFIED deleted 4 orphans.
   Per-student storage quota (STUDENT_UPLOAD_QUOTA) enforced on upload-url.
6. ✅ .env additions — LOG_LEVEL, LOG_JSON, SENTRY_DSN, WORKER_CONCURRENCY,
   DB_POOL_SIZE/MAX_OVERFLOW, STUDENT_UPLOAD_QUOTA. DB pool wired in db/session.py.

## Phase 5 — Monetization (deferred, per roadmap)

- Payme/Click (Uzbekistan) or Stripe; trial expiry; teacher-granted premium stays.

## Deep-research findings (verified, 2026-06; fold into Phases 2–3)

**Feedback UX (don't discourage):**
- Penalty-free speaking practice lowers anxiety (Duolingo deliberately does NOT
  correct grammar in real time during conversation; mistakes carry no punishment).
- Selective correction works best: flag ~1 mistake per 2–3 turns, correct
  pronunciation via repetition not criticism, deliver grammar fixes as text.
  → Cap visible corrections per result (top 3, "show more" behind a tap).
- Keep AI feedback SHORT — long feedback = cognitive overload (top complaint in studies).
- Score + retry beats score alone: immediate score, unlimited retries, syllable/word-level
  highlighting raised both skill AND intrinsic motivation (RCT evidence).
- Color-coded per-word feedback (green/yellow/pink) + encouraging threshold messages
  ("You got it!" ≥80%) is a proven teen pattern. We already store per-word accuracy → use it.
- Pair every score with a "how to improve" action (button → coaching), not raw numbers.
- Phoneme-level feedback beats global score for teens, but even a simple 0–100 score works
  — ship simple, deepen later.

**Gamification for teens (what backfires — arXiv study of 9yr Duolingo data):**
- Streak loss can cause total abandonment → we already have streak freezes; also add
  a gentle "streak repair" (one-time) and never shame on loss.
- Leagues/competitive leaderboards cause XP-farming + rank-chasing over learning;
  demotion is a demoralizing dark nudge → do NOT add leagues/demotion.
- Absolute full-class leaderboards pressure bottom-ranked students; relative
  leaderboard (you + 5 neighbors) avoids demotivation → change Leaderboard UI to
  show top 5 + "your neighborhood", weekly reset (we already have weekly XP).

**Practice modes (validated):**
- GPT-powered roleplay in chosen scenarios, machine-scored, is the SOTA pattern
  (Microsoft reference architecture = our exact Azure stack). 16-week study: large
  fluency gains (d≈1.0), students transfer phrases to classroom; key value =
  judgment-free private practice.
- Shadowing / listen-and-repeat with scripted assessment (reference_text) is proven.
- ASR misrecognition disrupts flow → always show transcript, let student re-record.

**Design (cozy not childish):** Duolingo's published shape language: rounded geometric
shapes, consistent corner radii, limited expressive palette, characters built from
simple shapes. → tokens + one mascot, restrained.

**Freemium:** paywall after value moment (post-score), not before; teacher-granted
premium is our classroom wedge. Trial-style "3 free attempts" is consistent with
edtech conversion patterns.

Full claim list + sources: tasks/wqgcragim.output (28 sources, 19 confirmed claims).

## Order of execution

Phase 1 → Phase 2 → Phase 3 (research-informed) → Phase 4 → Phase 5.
Each phase: implement → test in Docker → user verifies → commit.
