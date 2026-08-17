/**
 * Modal — the dialog contract (docs/03 §3.6 Containment).
 *
 * A dialog that does not restore focus, does not lock scroll, or closes when a
 * drag ends on the scrim is not visibly broken — it just quietly makes the app
 * unusable with a keyboard, and lets a mis-aimed pointer throw away whatever the
 * user was in the middle of.
 *
 * LIMIT OF THIS ENVIRONMENT: jsdom does no layout, so `offsetParent` is always
 * null and `getClientRects()` is always empty — the component's `focusable()`
 * therefore finds nothing here and Tab parks on the panel instead of cycling
 * through the buttons. What jsdom CAN prove is that focus never escapes the
 * dialog; the real cycle order is covered by the Playwright + axe pass.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

function open(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <Modal open onClose={onClose} title="Yordam markazi" {...props}>
      <button type="button">Ichkaridagi tugma</button>
    </Modal>,
  );
  return { onClose, user: userEvent.setup() };
}

describe("rendering", () => {
  it("mounts nothing while closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Yordam markazi">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its own title", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Yordam markazi" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("escapes any clipping ancestor by portalling to document.body", () => {
    open();
    // An `overflow: hidden` / `transform` ancestor would clip an in-tree dialog.
    expect(screen.getByRole("dialog").closest("body")).toBe(document.body);
  });

  it("names the close button so it is not announced as bare 'button'", () => {
    open({ closeLabel: "Yopish" });
    expect(screen.getByRole("button", { name: "Yopish" })).toBeInTheDocument();
  });
});

describe("dismissal", () => {
  it("closes on Escape", async () => {
    const { onClose, user } = open();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button", async () => {
    const { onClose, user } = open({ closeLabel: "Yopish" });
    await user.click(screen.getByRole("button", { name: "Yopish" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close on a click inside the panel", async () => {
    const { onClose, user } = open();
    await user.click(screen.getByRole("button", { name: "Ichkaridagi tugma" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("focus and scroll", () => {
  it("moves focus into the dialog on open", () => {
    open();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog", async () => {
    const { user } = open();
    await user.tab();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the trigger on close", async () => {
    function Harness() {
      const [isOpen, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Ochish
          </button>
          <Modal open={isOpen} onClose={() => setOpen(false)} title="Yordam" closeLabel="Yopish">
            <p>matn</p>
          </Modal>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Ochish" });

    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    // Without this the keyboard user is dumped at the top of the document and has
    // to Tab all the way back to where they were.
    expect(document.activeElement).toBe(trigger);
  });

  it("locks background scroll while open and restores it after", async () => {
    function Harness() {
      const [isOpen, setOpen] = useState(true);
      return (
        <Modal open={isOpen} onClose={() => setOpen(false)} title="Yordam" closeLabel="Yopish">
          <p>matn</p>
        </Modal>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });
});
