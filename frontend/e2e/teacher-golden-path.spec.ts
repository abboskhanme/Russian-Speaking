/**
 * The teacher golden path: Obzor → a class → a student → grade one attempt →
 * watch the queue shrink → assign a task → analytics.
 *
 * ONE journey, in order, for the same reason the student one is: these steps are
 * not independent, and five separate tests would mean five chances to pass a
 * step whose predecessor never ran.
 *
 * WHAT MAKES THIS MORE THAN A CLICK-THROUGH. Every mutating step is checked
 * against the API afterwards, not against the button having been clickable:
 *
 *   • the manual grade is read back from `/api/submissions/{id}/detail`, and the
 *     comment carries a per-run marker so a stale value cannot masquerade as a
 *     fresh write;
 *   • the queue is counted BEFORE and AFTER and must have shrunk by exactly one
 *     — in the API and in the nav badge, which are two different claims (the
 *     badge has been wrong while the data was right);
 *   • the assignment is looked up in `/api/assignments` by question.
 *
 * IDEMPOTENCE. Nothing here is cleaned up, because nothing here needs to be:
 * every assertion is relative to a value read at the start of the same run. The
 * journey grades one more attempt each time it runs and re-uses whichever
 * attempt is at the head of the queue, so consecutive runs neither collide nor
 * depend on each other. Grading is genuinely one-way — the API has no
 * un-review — so a relative assertion is not a convenience here, it is the only
 * honest way to state the claim.
 */
import {
  clickNav,
  escapeRe,
  expect,
  expectNoCriticalA11y,
  expectNoRawJson,
  expectPath,
  expectVisibleText,
  goTo,
  navItem,
  reportA11yTally,
  signInAs,
  test,
} from "./fixtures";
import { bearer, busiestTeacher, queueLength } from "./people";

const UUID = "[0-9a-f-]{36}";

test.afterAll(() => reportA11yTally("teacher golden path"));

interface QueueRow {
  id: string;
  student_name: string | null;
  question_title: string | null;
}
interface AttemptDetail {
  teacher_band: number | null;
  teacher_comment: string | null;
  reviewed_at: string | null;
}
interface AssignmentRow {
  question_title: string | null;
}

test("a teacher triages the queue, grades an attempt and assigns follow-up work", async ({
  page,
  request,
}) => {
  const teacher = await busiestTeacher(request);
  const auth = bearer(teacher.id);
  await signInAs(page, teacher.id);

  /* ── 1. Obzor ─────────────────────────────────────────────────────────────
     `/` is role-aware: a teacher must be REDIRECTED here, not shown the
     student Home with a teacher's data missing from it. */
  await test.step("a teacher's / resolves to the teacher panel", async () => {
    await goTo(page, "/", /^\/teacher$/);
    await expectVisibleText(page, escapeRe(teacher.name.split(/\s+/)[0]));
    await expectNoCriticalA11y(page, "/teacher (Obzor)");
    await expectNoRawJson(page, "/teacher (Obzor)");
  });

  /* ── 2. Klasslar → one group ──────────────────────────────────────────── */
  await test.step("the nav reaches Klasslar", async () => {
    await clickNav(page, "Klasslar", /^\/teacher\/classes$/);
    await expectNoCriticalA11y(page, "/teacher/classes");
    await expectNoRawJson(page, "/teacher/classes");
  });

  const groups = (await (await request.get("/api/groups", { headers: auth })).json()) as {
    id: string;
    name: string;
    member_count: number;
  }[];
  expect(groups.length, `${teacher.name} owns no group to open`).toBeGreaterThan(0);
  const group = groups[0];

  await test.step("a group card opens its roster", async () => {
    await expectVisibleText(page, group.name);
    await page.getByRole("button", { name: "Ochish", exact: true }).first().click();
    await expectPath(page, new RegExp(`^/teacher/classes/${UUID}$`));
    await expectVisibleText(page, group.name);
    await expectNoCriticalA11y(page, "/teacher/classes/:groupId");
    await expectNoRawJson(page, "/teacher/classes/:groupId");
  });

  /* ── 3. A roster row → that student's profile ─────────────────────────── */
  const detail = (await (
    await request.get(`/api/groups/${group.id}`, { headers: auth })
  ).json()) as { members: { id: string; full_name: string }[] };
  expect(detail.members.length, `${group.name} has an empty roster`).toBeGreaterThan(0);
  const member = detail.members[0];

  await test.step("a roster row opens the student profile", async () => {
    // By NAME, from the API. The first attempt at this matched "any button whose
    // text ends in a number", which is also true of the nav's own "Navbat 24" —
    // so the run left for the queue and the next step reported a missing student
    // profile. A loose text filter does not fail here, it teleports.
    await page.getByRole("button", { name: new RegExp(escapeRe(member.full_name)) }).first().click();
    await expectPath(page, new RegExp(`^/teacher/students/${UUID}$`));
    expect(new URL(page.url()).pathname.split("/").pop()).toBe(member.id);
    await expectVisibleText(page, member.full_name);
    await expectNoCriticalA11y(page, "/teacher/students/:studentId");
    await expectNoRawJson(page, "/teacher/students/:studentId");
  });

  /* ── 4. Navbat: grade the head of the queue ───────────────────────────────
     Read the queue from the API FIRST. The count is the thing the next two
     steps are measured against, so it has to be taken before anything is
     clicked, not inferred from what the screen happens to show. */
  const before = await queueLength(request, teacher.id);
  expect(
    before,
    `${teacher.name} has an empty grading queue — nothing left in this database to grade. ` +
      "Re-seed the demo data (deploy/seed) before expecting this journey to prove anything.",
  ).toBeGreaterThan(0);

  await test.step("the nav reaches Navbat, and the badge agrees with the API", async () => {
    // The badge is part of the accessible name ("Navbat 24" / "24Navbat"), which
    // is why this destination is matched by pattern rather than exact text.
    await clickNav(page, /Navbat/, /^\/teacher\/queue$/);
    await expectVisibleText(page, String(before));
    await expectNoCriticalA11y(page, "/teacher/queue");
    await expectNoRawJson(page, "/teacher/queue");
  });

  const queue = (await (
    await request.get("/api/submissions?needs_review=true&limit=200", { headers: auth })
  ).json()) as QueueRow[];
  const target = queue[0];

  await test.step("Tahrir opens that attempt's detail", async () => {
    // The queue CARD is a plain div — "Tahrir" is the only way in, and the
    // sibling "✓ Tasdiqlash" would grade it without ever opening it.
    await page.getByRole("button", { name: "Tahrir", exact: true }).first().click();
    await expectPath(page, new RegExp(`^/teacher/queue/${UUID}$`));
    expect(new URL(page.url()).pathname.split("/").pop()).toBe(target.id);
    if (target.student_name) await expectVisibleText(page, target.student_name);
    // This screen renders `feedback` + `corrections`, both JSON columns — it is
    // the teacher-side twin of the bug the student raw-JSON grep was written for.
    await expectNoRawJson(page, "/teacher/queue/:attemptId");
    await expectNoCriticalA11y(page, "/teacher/queue/:attemptId");
  });

  // A per-run marker: without it, a comment left by an earlier run reads exactly
  // like a successful write by this one.
  const marker = `e2e-${Date.now()}`;
  const band = 71;

  await test.step("a manual grade is entered and saved", async () => {
    await page.getByRole("button", { name: /Qo.?lda baholash/i }).click();

    const slider = page.getByRole("slider");
    await expect(slider, "the manual-grading sheet should offer one band slider").toHaveCount(1);
    await slider.fill(String(band));

    const comment = page.getByRole("textbox");
    await expect(comment, "the manual-grading sheet should offer one comment box").toHaveCount(1);
    await comment.fill(`Tekshirildi ${marker}`);

    await page.getByRole("button", { name: "Saqlash", exact: true }).click();
    // Still on the attempt: saving refetches in place rather than navigating.
    await expectPath(page, new RegExp(`^/teacher/queue/${UUID}$`));
  });

  await test.step("the verdict is in the database, not just on the screen", async () => {
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/submissions/${target.id}/detail`, { headers: auth });
          return (await res.json()) as AttemptDetail;
        },
        { message: "the teacher's verdict never reached the API" },
      )
      .toMatchObject({ teacher_band: band, teacher_comment: `Tekshirildi ${marker}` });

    const detail = (await (
      await request.get(`/api/submissions/${target.id}/detail`, { headers: auth })
    ).json()) as AttemptDetail;
    expect(detail.reviewed_at, "a graded attempt must be stamped reviewed").not.toBeNull();
  });

  await test.step("the queue is one shorter — in the API and in the nav badge", async () => {
    expect(await queueLength(request, teacher.id), "grading did not remove the attempt").toBe(
      before - 1,
    );

    await clickNav(page, /Navbat/, /^\/teacher\/queue$/);
    // The badge is a second, independent claim: it has been stale while the
    // underlying data was already correct.
    await expect
      .poll(async () => (await navItem(page, /Navbat/).innerText()).replace(/\D+/g, ""), {
        message: "the Navbat badge did not follow the queue down",
      })
      .toBe(String(before - 1));
  });

  /* ── 5. Assign follow-up work ─────────────────────────────────────────── */
  await test.step("a task is assigned to the whole group", async () => {
    await goTo(page, "/teacher/assign", /^\/teacher\/assign$/);
    await expectNoCriticalA11y(page, "/teacher/assign");

    // Which task to pick comes from the API, by title. Matching the picker's own
    // rows by shape does not work: it lists MODULLAR above VAZIFALAR and a module
    // row ("Обычный русский · Быт  A1 · 5 vazifa") carries a CEFR level too, so
    // "the row with a level in it" selects the module and assigns five tasks
    // under a name that is not any of them.
    const questions = (await (
      await request.get("/api/questions?published=true&limit=50", { headers: auth })
    ).json()) as { id: string; title: string }[];
    expect(questions.length, "this teacher has no published task to assign").toBeGreaterThan(0);
    const taskTitle = questions[0].title;

    await page.getByRole("button", { name: /Vazifa yoki modul tanlang/i }).click();
    const task = page.getByRole("button", { name: new RegExp(escapeRe(taskTitle)) });
    expect(await task.count(), `the picker does not list "${taskTitle}"`).toBeGreaterThan(0);
    await task.first().click();
    await page.getByRole("radio").first().click();

    // The submit label counts the recipients ("6 o'quvchiga topshirish"), so it
    // cannot be matched literally — and it stays disabled until both a task and
    // a group are chosen, which is itself worth asserting.
    const submit = page.getByRole("button", { name: /topshirish/i });
    await expect(submit, "the assign button never became actionable").toBeEnabled();
    await submit.click();

    await expectVisibleText(page, /topshiriq berildi/i);

    // DB truth: the task now appears in this teacher's assignments. Stated as
    // presence rather than as a delta because the API de-duplicates — a second
    // run assigns the same task to the same group and creates nothing new, and
    // "no rows added" would be a false failure.
    const assignments = (await (
      await request.get("/api/assignments", { headers: auth })
    ).json()) as AssignmentRow[];
    expect(
      assignments.map((a) => a.question_title ?? ""),
      `no assignment row for the task just assigned (${taskTitle})`,
    ).toContain(taskTitle);
  });

  /* ── 6. Analitika ─────────────────────────────────────────────────────── */
  await test.step("the nav reaches Analitika", async () => {
    await clickNav(page, "Analitika", /^\/teacher\/analytics$/);
    await expectNoCriticalA11y(page, "/teacher/analytics");
    await expectNoRawJson(page, "/teacher/analytics");
  });
});

/**
 * A teacher is not an admin. `/admin/*` is the one subtree the teacher panel does
 * NOT admit (RequireRole allows only `admin` there, unlike `/teacher/*` which
 * admits both), and the student screens are closed to them from the other side.
 * Typing the URL is the point: this is the check that a route is guarded rather
 * than merely unlinked.
 */
test("a teacher cannot reach the admin panel or the student screens", async ({ page, request }) => {
  const teacher = await busiestTeacher(request);
  await signInAs(page, teacher.id);

  for (const forbidden of ["/admin", "/admin/settings", "/admin/students", "/admin/teachers"]) {
    await goTo(page, forbidden, /^\/teacher$/);
  }
  for (const studentOnly of ["/practice", "/results", "/progress", "/profile"]) {
    await goTo(page, studentOnly, /^\/teacher$/);
  }
});
