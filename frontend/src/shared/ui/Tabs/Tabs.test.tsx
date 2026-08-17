/**
 * Tabs — the segmented control's keyboard contract (docs/03 §3.6).
 *
 * Every tabbed surface in the app (Profil, Progress, Klasslar, Kontent,
 * Analitika) is this one component, so its ARIA and roving-tabindex behaviour is
 * the difference between the whole app being keyboard-operable and not. None of
 * it shows up in a screenshot, and the wrap-around index maths in `step()` is
 * exactly the kind of expression that survives a rewrite while quietly getting
 * the disabled and last-item cases wrong.
 *
 * `Tabs` is controlled, so the harness below owns `activeKey` — testing it
 * against a frozen prop would make "clicking the active tab is a no-op" pass for
 * the wrong reason (nothing ever becomes active).
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "./Tabs";
import type { TabItem } from "./Tabs";

const items: TabItem[] = [
  { key: "info", label: "Ma'lumot" },
  { key: "results", label: "Natijalar" },
  { key: "settings", label: "Sozlamalar" },
];

function setup(initial = "info", list: TabItem[] = items) {
  const onChange = vi.fn();
  function Harness() {
    const [activeKey, setActiveKey] = useState(initial);
    return (
      <Tabs
        items={list}
        activeKey={activeKey}
        onChange={(key) => {
          onChange(key);
          setActiveKey(key);
        }}
        aria-label="Profil"
      />
    );
  }
  render(<Harness />);
  return { onChange, user: userEvent.setup() };
}

describe("semantics", () => {
  it("exposes a named tablist with one selected tab", () => {
    setup("results");
    expect(screen.getByRole("tablist", { name: "Profil" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Natijalar");
  });

  it("keeps exactly ONE tab in the tab order", () => {
    // Roving tabindex: three tabs each reachable by Tab would make a five-tab
    // surface cost five keystrokes to walk past.
    setup("results");
    const inOrder = screen.getAllByRole("tab").filter((t) => t.getAttribute("tabindex") === "0");
    expect(inOrder).toHaveLength(1);
    expect(inOrder[0]).toHaveTextContent("Natijalar");
  });

  it("keeps a tab reachable when activeKey matches nothing", () => {
    // Happens whenever a `?tab=` query param outlives the tab it named.
    setup("deleted-tab");
    expect(screen.queryByRole("tab", { selected: true })).toBeNull();
    const inOrder = screen.getAllByRole("tab").filter((t) => t.getAttribute("tabindex") === "0");
    expect(inOrder).toHaveLength(1);
  });

  it("wires aria-controls to the consumer's panel id", () => {
    render(
      <Tabs
        items={[{ key: "a", label: "A", panelId: "panel-a" }]}
        activeKey="a"
        onChange={vi.fn()}
        aria-label="X"
      />,
    );
    const tab = screen.getByRole("tab");
    expect(tab).toHaveAttribute("aria-controls", "panel-a");
    expect(tab).toHaveAttribute("id", "panel-a-tab");
  });
});

describe("keyboard navigation", () => {
  it("moves and activates with the arrow keys", async () => {
    const { onChange, user } = setup("info");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("results");
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Natijalar");
  });

  it("wraps around at both ends", async () => {
    const { onChange, user } = setup("info");
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("settings");
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("info");
  });

  it("treats ArrowUp/ArrowDown as the same axis", async () => {
    const { onChange, user } = setup("info");
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("results");
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("info");
  });

  it("jumps to the ends with Home and End", async () => {
    const { onChange, user } = setup("results");
    await user.tab();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("settings");
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("info");
  });

  it("steps OVER a disabled tab instead of stopping on it", async () => {
    const { onChange, user } = setup("a", [
      { key: "a", label: "A" },
      { key: "b", label: "B", disabled: true },
      { key: "c", label: "C" },
    ]);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(onChange).not.toHaveBeenCalledWith("b");
  });

  it("lands on the first ENABLED tab for Home", async () => {
    const { onChange, user } = setup("c", [
      { key: "a", label: "A", disabled: true },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ]);
    await user.tab();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("b");
  });
});

describe("pointer", () => {
  it("fires onChange once per new selection and never for the active one", async () => {
    const { onChange, user } = setup("info");
    await user.click(screen.getByRole("tab", { name: "Natijalar" }));
    expect(onChange).toHaveBeenCalledTimes(1);

    // Re-clicking the now-active tab must not churn the consumer's state.
    await user.click(screen.getByRole("tab", { name: "Natijalar" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores a click on a disabled tab", async () => {
    const { onChange, user } = setup("a", [
      { key: "a", label: "A" },
      { key: "b", label: "B", disabled: true },
    ]);
    await user.click(screen.getByRole("tab", { name: "B" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
