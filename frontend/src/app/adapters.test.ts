/**
 * app/adapters — the wire→screen mappers.
 *
 * These are the app's only pure logic of any size, and two of them guard bugs
 * that reached users: `parseFeedback` / `parseCorrections` exist because the
 * `evaluations.feedback` column holds a serialised `GraderResult`, and rendering
 * it raw put a JSON blob on the student's result screen. `relativeTime` and
 * `dateParts` exist because Chromium ships a REDUCED ICU with no Uzbek data, so
 * anything built on `Intl` looks correct in Node and renders `"2026 M07"` in the
 * browser — a test that used `Intl` to compute its own expectation would agree
 * with the bug. Every expectation below is therefore a literal.
 */
import { describe, expect, it } from "vitest";
import type {
  LeaderboardEntryResponse,
  StudentModuleResponse,
  StudentTaskResponse,
} from "../shared/api";
import {
  clampPct,
  dateParts,
  firstName,
  formatDayMonth,
  gradingFailureKey,
  moduleProgressPct,
  myLeaderboardRow,
  parseCorrections,
  parseFeedback,
  nextOpenTarget,
  pickPracticeTarget,
  relativeTime,
} from "./adapters";
import enCommon from "../locales/en/common.json";
import ruCommon from "../locales/ru/common.json";
import uzCommon from "../locales/uz/common.json";

/** Fixed clock, so "2 soat oldin" means the same thing in CI as it does here. */
const NOW = new Date("2026-07-30T21:00:00Z");
/** `n` seconds before {@link NOW}, as the ISO string the API would send. */
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

// Fully-typed fixtures rather than `as` casts: if a wire field is renamed in
// shared/api/types.ts, these stop compiling, which is the point.
function studentModule(over: Partial<StudentModuleResponse> = {}): StudentModuleResponse {
  return {
    id: "m1",
    name: "Modul",
    topic: null,
    level: null,
    ru_style: null,
    visibility: "public",
    cover_url: null,
    total: 0,
    done_count: 0,
    next_task_id: null,
    tasks: [],
    spent_sec: 0,
    ...over,
  };
}

function task(id: string): StudentTaskResponse {
  return {
    id,
    title: id,
    type: "text",
    level: null,
    sort_order: 0,
    done: false,
    locked: false,
    premium_locked: false,
    band: null,
    prep_time_sec: 0,
    answer_time_limit_sec: 0,
  };
}

function leaderboardRow(over: Partial<LeaderboardEntryResponse> = {}): LeaderboardEntryResponse {
  return {
    rank: 1,
    id: "u1",
    full_name: "Aziz Karimov",
    xp: 0,
    weekly_xp: 0,
    current_streak: 0,
    is_me: false,
    ...over,
  };
}

describe("firstName", () => {
  it("takes the first whitespace-delimited word", () => {
    expect(firstName("Aziz Karimov")).toBe("Aziz");
    expect(firstName("  Aziz   Karimov  ")).toBe("Aziz");
  });

  it("returns an empty string rather than undefined for empty input", () => {
    // The greeting interpolates this straight into `home.greetHi`; `undefined`
    // would render the literal text "undefined" next to "Salom,".
    expect(firstName("")).toBe("");
    expect(firstName("   ")).toBe("");
  });
});

describe("relativeTime", () => {
  it("picks the largest unit that fits", () => {
    expect(relativeTime(ago(7200), NOW)).toEqual({ key: "time.hoursAgo", count: 2 });
    expect(relativeTime(ago(3 * 86_400), NOW)).toEqual({ key: "time.daysAgo", count: 3 });
    expect(relativeTime(ago(3 * 604_800), NOW)).toEqual({ key: "time.weeksAgo", count: 3 });
    expect(relativeTime(ago(3 * 2_592_000), NOW)).toEqual({ key: "time.monthsAgo", count: 3 });
    expect(relativeTime(ago(3 * 31_536_000), NOW)).toEqual({ key: "time.yearsAgo", count: 3 });
  });

  it("switches unit exactly at the boundary", () => {
    expect(relativeTime(ago(59), NOW)).toEqual({ key: "time.justNow", count: 0 });
    expect(relativeTime(ago(60), NOW)).toEqual({ key: "time.minutesAgo", count: 1 });
    expect(relativeTime(ago(3599), NOW)).toEqual({ key: "time.minutesAgo", count: 59 });
    expect(relativeTime(ago(3600), NOW)).toEqual({ key: "time.hoursAgo", count: 1 });
  });

  it("says «kecha» rather than «1 kun oldin»", () => {
    expect(relativeTime(ago(86_400), NOW)).toEqual({ key: "time.yesterday", count: 1 });
    expect(relativeTime(ago(2 * 86_400), NOW)).toEqual({ key: "time.daysAgo", count: 2 });
  });

  it("clamps a future timestamp to «hozirgina»", () => {
    // Server and phone clocks disagree by seconds routinely; a negative age would
    // otherwise render "-1 daqiqa oldin".
    expect(relativeTime(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toEqual({
      key: "time.justNow",
      count: 0,
    });
  });

  it("degrades to «hozirgina» on an unparseable timestamp", () => {
    expect(relativeTime("not-a-date", NOW)).toEqual({ key: "time.justNow", count: 0 });
    expect(relativeTime("", NOW)).toEqual({ key: "time.justNow", count: 0 });
  });
});

describe("dateParts", () => {
  it("splits a timestamp into 1-based month and a zero-padded clock", () => {
    // Local time by design — assert against a locally-constructed date so the
    // test states the contract rather than the runner's TZ.
    const local = new Date(2026, 6, 5, 9, 7);
    expect(dateParts(local.toISOString())).toEqual({
      day: 5,
      month: 7,
      year: 2026,
      time: "09:07",
    });
  });

  it("returns null for an unparseable value so the caller can omit the line", () => {
    expect(dateParts("nope")).toBeNull();
  });
});

describe("formatDayMonth", () => {
  // A `t` over the REAL locale files, so the test pins what users read — the
  // genitive lives in the JSON, and a fake dictionary would only test itself.
  const tFor = (time: Record<string, string>) => (key: string, opts: Record<string, unknown> = {}) =>
    (time[key.replace(/^time\./, "")] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k]));
  const iso = new Date(2026, 6, 30, 21, 0).toISOString();

  it("puts Russian in the genitive after a day number — «30 июля», never «30 июль»", () => {
    const t = tFor(ruCommon.time);
    expect(formatDayMonth(iso, t)).toBe("30 июля");
    expect(formatDayMonth(iso, t, true)).toBe("30 июля, 21:00");
  });

  it("writes Uzbek and English in their own order", () => {
    expect(formatDayMonth(iso, tFor(uzCommon.time), true)).toBe("30-iyul 21:00");
    expect(formatDayMonth(iso, tFor(enCommon.time))).toBe("Jul 30");
  });

  it("is empty for an unparseable value", () => {
    expect(formatDayMonth("nope", tFor(uzCommon.time))).toBe("");
  });
});

describe("clampPct / moduleProgressPct", () => {
  it("clamps to 0–100 and rounds", () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(33.4)).toBe(33);
    expect(clampPct(33.5)).toBe(34);
  });

  it("reports 0% for an empty module instead of NaN", () => {
    // `0/0` is NaN, and `width: NaN%` collapses the bar with no error anywhere.
    expect(moduleProgressPct(studentModule({ done_count: 0, total: 0 }))).toBe(0);
    expect(moduleProgressPct(studentModule({ done_count: 1, total: 4 }))).toBe(25);
  });
});

describe("pickPracticeTarget", () => {
  const modules = [
    studentModule({ id: "m1", tasks: [task("a"), task("b")], next_task_id: null }),
    studentModule({ id: "m2", tasks: [task("c"), task("d")], next_task_id: "d" }),
  ];

  it("honours an explicit task id, across modules", () => {
    expect(pickPracticeTarget(modules, "b")).toMatchObject({ task: { id: "b" }, index: 2 });
    expect(pickPracticeTarget(modules, "c")).toMatchObject({ task: { id: "c" }, index: 1 });
  });

  it("numbers the index from 1, for the progress pips", () => {
    expect(pickPracticeTarget(modules, "a")?.index).toBe(1);
  });

  it("falls back to the first module that has a next task", () => {
    expect(pickPracticeTarget(modules)).toMatchObject({ module: { id: "m2" }, task: { id: "d" } });
  });

  it("returns null when nothing is reachable", () => {
    expect(pickPracticeTarget([])).toBeNull();
    expect(pickPracticeTarget([studentModule({ next_task_id: null })])).toBeNull();
    // A next_task_id pointing at a task the module does not list is stale data,
    // not a target — resolving it would send Practice to an undefined task.
    expect(pickPracticeTarget([studentModule({ tasks: [task("a")], next_task_id: "gone" })])).toBeNull();
  });

  // This used to fall back to the first open task ("d"), which put a DIFFERENT
  // question in front of a student who had followed a link to a specific one —
  // an unpublished assignment was silently answered as some other task. An
  // unknown id is now "not available", never a substitute.
  it("resolves an unknown explicit id to null, never to another task", () => {
    expect(pickPracticeTarget(modules, "missing")).toBeNull();
  });
});

describe("nextOpenTarget", () => {
  function open(id: string, over: Partial<StudentTaskResponse> = {}): StudentTaskResponse {
    return { ...task(id), ...over };
  }
  const modules = [
    studentModule({
      id: "m1",
      tasks: [open("a", { done: true }), open("b"), open("c", { locked: true })],
    }),
    studentModule({
      id: "m2",
      tasks: [open("d", { premium_locked: true }), open("e"), open("f")],
    }),
  ];

  it("moves to the next OPEN task, skipping done and locked ones", () => {
    expect(nextOpenTarget(modules, "b")).toMatchObject({ task: { id: "e" }, module: { id: "m2" } });
    expect(nextOpenTarget(modules, "e")).toMatchObject({ task: { id: "f" }, index: 3 });
  });

  it("wraps round to the start instead of running off the end", () => {
    expect(nextOpenTarget(modules, "f")).toMatchObject({ task: { id: "b" } });
  });

  it("never hands back the task being skipped", () => {
    const single = [studentModule({ tasks: [open("only")] })];
    expect(nextOpenTarget(single, "only")).toBeNull();
  });

  it("starts from the top when the current id is not listed", () => {
    expect(nextOpenTarget(modules, "gone")).toMatchObject({ task: { id: "b" } });
    expect(nextOpenTarget(modules)).toMatchObject({ task: { id: "b" } });
  });
});

describe("gradingFailureKey", () => {
  it("maps each known machine code to its own sentence", () => {
    expect(gradingFailureKey("grader_failed")).toBe("results.failure.grader_failed");
    expect(gradingFailureKey("grading_timeout")).toBe("results.failure.grading_timeout");
    expect(gradingFailureKey("stt_failed")).toBe("results.failure.stt_failed");
    expect(gradingFailureKey("ai_unavailable")).toBe("results.failure.ai_unavailable");
  });

  it("reads free text (pre-code rows), an unknown code, or none as `internal` — never raw", () => {
    expect(gradingFailureKey("NullReferenceException: boom")).toBe("results.failure.internal");
    expect(gradingFailureKey("no_speech")).toBe("results.failure.internal");
    expect(gradingFailureKey(null)).toBe("results.failure.internal");
    expect(gradingFailureKey(undefined)).toBe("results.failure.internal");
  });
});

describe("myLeaderboardRow", () => {
  it("finds the row flagged is_me", () => {
    const rows = [
      leaderboardRow({ id: "1", rank: 1 }),
      leaderboardRow({ id: "2", rank: 2, is_me: true }),
    ];
    expect(myLeaderboardRow(rows)?.id).toBe("2");
    expect(myLeaderboardRow(rows.slice(0, 1))).toBeNull();
    expect(myLeaderboardRow([])).toBeNull();
  });
});

describe("parseFeedback", () => {
  it("unpacks the serialised GraderResult", () => {
    const raw = JSON.stringify({
      summary: "Yaxshi",
      strengths: ["talaffuz"],
      improvements: ["tezlik"],
      vocabulary_suggestions: ["привет"],
      orthoepy_errors: [],
    });
    expect(parseFeedback(raw)).toEqual({
      summary: "Yaxshi",
      strengths: ["talaffuz"],
      improvements: ["tezlik"],
      vocabulary: ["привет"],
    });
  });

  it("never lets a JSON brace reach the screen", () => {
    // The bug this function exists for: the column holds JSON, and printing it
    // put `{"summary":…}` in front of the student.
    const parsed = parseFeedback(JSON.stringify({ summary: "Yaxshi", strengths: [] }));
    expect(parsed?.summary).not.toContain("{");
    expect(parsed?.summary).toBe("Yaxshi");
  });

  it("keeps a legacy plain-prose row readable", () => {
    expect(parseFeedback("Ajoyib ish!")).toEqual({
      summary: "Ajoyib ish!",
      strengths: [],
      improvements: [],
      vocabulary: [],
    });
  });

  it("returns null when there is nothing to show, so the section can be hidden", () => {
    expect(parseFeedback(null)).toBeNull();
    expect(parseFeedback("")).toBeNull();
    expect(parseFeedback("   ")).toBeNull();
    expect(parseFeedback("{}")).toBeNull();
    expect(parseFeedback(JSON.stringify({ summary: "", strengths: [] }))).toBeNull();
  });

  it("drops non-string list members", () => {
    const raw = JSON.stringify({ summary: "s", strengths: ["ok", 3, null, { a: 1 }] });
    expect(parseFeedback(raw)?.strengths).toEqual(["ok"]);
  });
});

describe("parseCorrections", () => {
  it("maps the array and fills missing fields with empty strings", () => {
    const raw = JSON.stringify([
      { original: "я идти", corrected: "я иду", type: "grammar", explanation: "…" },
      { original: "он читал книга", corrected: "он читал книгу" },
    ]);
    expect(parseCorrections(raw)).toEqual([
      { original: "я идти", corrected: "я иду", type: "grammar", explanation: "…" },
      { original: "он читал книга", corrected: "он читал книгу", type: "", explanation: "" },
    ]);
  });

  it("drops an entry that has neither side", () => {
    const raw = JSON.stringify([{ type: "grammar", explanation: "only prose" }, { original: "x" }]);
    expect(parseCorrections(raw)).toEqual([
      { original: "x", corrected: "", type: "", explanation: "" },
    ]);
  });

  it("returns [] for absent, malformed or non-array data", () => {
    expect(parseCorrections(null)).toEqual([]);
    expect(parseCorrections("")).toEqual([]);
    expect(parseCorrections("not json")).toEqual([]);
    expect(parseCorrections('{"a":1}')).toEqual([]);
    expect(parseCorrections("[null]")).toEqual([]);
  });
});
