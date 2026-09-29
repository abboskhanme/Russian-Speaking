/**
 * Shared fixtures for the /task page tests — a small catalogue, a stand-in for
 * the Recorder (jsdom has no MediaRecorder) and a probe that shows where the
 * router ended up. Not a test file itself (no `.test.` in the name).
 */
import { useLocation } from "react-router-dom";
import type { StudentModuleResponse, StudentTaskResponse } from "../../shared/api";

export function task(id: string, over: Partial<StudentTaskResponse> = {}): StudentTaskResponse {
  return {
    id,
    title: `Title ${id}`,
    type: "text",
    level: "A2",
    sort_order: 0,
    done: false,
    locked: false,
    premium_locked: false,
    band: null,
    ...over,
  };
}

/** t1 carries the new content fields; t2 is a plain open task; t3 is behind Premium. */
export const CATALOGUE: StudentModuleResponse[] = [
  {
    id: "m1",
    name: "Kundalik muloqot",
    topic: null,
    level: "A2",
    ru_style: null,
    visibility: "public",
    cover_url: null,
    total: 3,
    done_count: 0,
    next_task_id: "t1",
    spent_sec: 0,
    tasks: [
      task("t1", {
        title: "Do'konda",
        prompt_text: "Расскажите, что вы вчера купили в магазине.",
        instruction_text: "3–4 gap bilan javob bering.",
        media_url: "https://cdn.example/shop.png",
        media_type: "image",
        prep_time_sec: 30,
        answer_time_limit_sec: 90,
      }),
      task("t2", { title: "Oila haqida" }),
      task("t3", { title: "Shifokorda", premium_locked: true }),
    ],
  },
];

/** An ApiError-shaped rejection (`isApiError` checks the name). */
export function apiError(status: number, retryAfterSec: number | null = null): Error {
  return Object.assign(new Error(`http_${status}`), {
    name: "ApiError",
    status,
    detail: "This task isn't assigned to you, or its deadline has passed.",
    body: null,
    retryAfterSec,
  });
}

/** Renders where the router ended up, so a navigation can be asserted. */
export function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
