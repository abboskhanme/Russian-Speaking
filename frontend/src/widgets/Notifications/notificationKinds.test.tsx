/**
 * Notification rows for the new types.
 *
 * The server stores RENDERED title/body text plus a `type` and `link`. So the
 * centre prints the text as given and lets the type choose only an icon and a
 * fallback destination. The two failure modes worth pinning are the silent ones:
 * a type this build does not know must still render (no crash, no blank row), and
 * the raw type string must never reach the screen.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { NotificationResponse } from "../../shared/api";
import { isKnownKind, notificationLink } from "./notificationKinds";
import { NotificationsModal } from "./NotificationsModal";

const { rows } = vi.hoisted(() => ({ rows: { list: [] as NotificationResponse[] } }));

vi.mock("../../shared/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/api")>();
  return {
    ...actual,
    endpoints: { ...actual.endpoints, listNotifications: () => Promise.resolve(rows.list) },
  };
});

function row(over: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: Math.random().toString(36).slice(2),
    type: "review_added",
    title: "Sarlavha",
    body: null,
    link: null,
    is_read: false,
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe("notificationLink", () => {
  it("prefers the server's own link", () => {
    expect(notificationLink("review_done", "/results/abc")).toBe("/results/abc");
    expect(notificationLink("join_request", "/teacher/classes?tab=requests&x=1")).toBe(
      "/teacher/classes?tab=requests&x=1",
    );
  });

  it("falls back per type for rows written without one", () => {
    expect(notificationLink("join_request", null)).toBe("/teacher/classes?tab=requests");
    expect(notificationLink("assignment_new", null)).toBe("/practice?tab=assignments");
    expect(notificationLink("join_approved", "  ")).toBe("/group");
    expect(notificationLink("join_rejected", null)).toBe("/group");
    expect(notificationLink("review_added", null)).toBe("/review");
    // A graded answer has no generic destination — only its own /results/{id}.
    expect(notificationLink("review_done", null)).toBeNull();
  });

  it("gives an unknown type no destination at all", () => {
    expect(isKnownKind("streak_lost")).toBe(false);
    expect(notificationLink("streak_lost", null)).toBeNull();
    // Inherited object keys are not "known types".
    expect(isKnownKind("toString")).toBe(false);
  });
});

describe("the centre renders every type", () => {
  it("prints stored text for all five new types and an unknown one, never a type string", async () => {
    rows.list = [
      row({ type: "assignment_new", title: "Yangi topshiriq", link: "/practice?tab=assignments" }),
      row({ type: "review_done", title: "Javobingiz tekshirildi", link: "/results/r1" }),
      row({ type: "join_approved", title: "Guruhga qabul qilindingiz" }),
      row({ type: "join_rejected", title: "So'rov rad etildi" }),
      row({ type: "join_request", title: "Yangi qo'shilish so'rovi", body: "Aziz · Kechki-3" }),
      row({ type: "totally_new_kind", title: "Kelajakdagi xabar" }),
      row({ type: "totally_new_kind", title: "   " }),
    ];
    render(<NotificationsModal open onClose={() => undefined} />);

    const dialog = await screen.findByRole("dialog");
    for (const title of [
      "Yangi topshiriq",
      "Javobingiz tekshirildi",
      "Guruhga qabul qilindingiz",
      "So'rov rad etildi",
      "Yangi qo'shilish so'rovi",
      "Kelajakdagi xabar",
    ]) {
      expect(await within(dialog).findByText(title)).toBeInTheDocument();
    }
    expect(within(dialog).getByText("Aziz · Kechki-3")).toBeInTheDocument();

    // The teacher's request row goes to the So'rovlar tab, the known link fallback.
    const req = within(dialog).getByText("Yangi qo'shilish so'rovi").closest("a");
    expect(req).toHaveAttribute("href", "/teacher/classes?tab=requests");
    // The unknown type renders as a plain row, not a link to nowhere.
    expect(within(dialog).getByText("Kelajakdagi xabar").closest("a")).toBeNull();

    const text = dialog.textContent ?? "";
    for (const type of ["assignment_new", "review_done", "join_approved", "join_rejected", "join_request", "totally_new_kind"]) {
      expect(text).not.toContain(type);
    }
  });
});
