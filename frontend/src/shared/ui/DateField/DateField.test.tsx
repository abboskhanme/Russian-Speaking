import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../i18n";
import { DateField, DateTimeField } from "./DateField";
import { isoDateToDisplay, maskDate, maskTime, parseDisplayDate, parseTime } from "./dateMask";

const t = i18n.getFixedT("uz", "common");

describe("dateMask", () => {
  it("masks digits progressively", () => {
    expect(maskDate("2")).toBe("2");
    expect(maskDate("2110")).toBe("21.10");
    expect(maskDate("21102026999")).toBe("21.10.2026");
    expect(maskDate("21.1")).toBe("21.1");
    expect(maskTime("143")).toBe("14:3");
  });

  it("parses only real dates and times", () => {
    expect(parseDisplayDate("21.10.2026")).toBe("2026-10-21");
    expect(parseDisplayDate("31.02.2026")).toBeNull();
    expect(parseDisplayDate("21.10.26")).toBeNull();
    expect(isoDateToDisplay("2026-10-21")).toBe("21.10.2026");
    expect(parseTime("9:05")).toBe("09:05");
    expect(parseTime("24:00")).toBeNull();
  });
});

function Controlled(props: { onChange: (v: string) => void; min?: string; initial?: string }) {
  const [v, setV] = useState(props.initial ?? "");
  return (
    <DateField
      label="Dan"
      value={v}
      min={props.min}
      onChange={(next) => {
        setV(next);
        props.onChange(next);
      }}
    />
  );
}

describe("DateField", () => {
  it("is a labelled text box that reports yyyy-MM-dd once complete", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Dan" });
    expect(box).toHaveAttribute("placeholder", t("dateField.placeholder"));
    await userEvent.type(box, "21102026");
    expect(box).toHaveValue("21.10.2026");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-21");
  });

  it("flags an impossible date and keeps the value empty", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Dan" });
    await userEvent.type(box, "31022026");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(t("dateField.invalid"))).toBeInTheDocument();
  });

  it("enforces min", async () => {
    render(<Controlled onChange={() => {}} min="2026-10-01" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Dan" }), "30092026");
    expect(screen.getByText(t("dateField.tooEarly", { date: "01.10.2026" }))).toBeInTheDocument();
  });

  it("has a calendar button, and the native picker's choice fills the field", () => {
    const onChange = vi.fn();
    const { container } = render(<Controlled onChange={onChange} />);
    expect(screen.getByRole("button", { name: t("dateField.openCalendar") })).toBeInTheDocument();
    const native = container.querySelector('input[type="date"]') as HTMLInputElement;
    expect(native).toHaveAttribute("tabindex", "-1");
    fireEvent.change(native, { target: { value: "2026-03-05" } });
    expect(screen.getByRole("textbox", { name: "Dan" })).toHaveValue("05.03.2026");
    expect(onChange).toHaveBeenLastCalledWith("2026-03-05");
  });

  it("follows a reset from the caller", () => {
    const { rerender } = render(<DateField label="Dan" value="2026-10-21" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Dan" })).toHaveValue("21.10.2026");
    rerender(<DateField label="Dan" value="" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Dan" })).toHaveValue("");
  });
});

describe("DateTimeField", () => {
  it("combines date + 24h time, defaulting a blank time to the end of the day", async () => {
    const onChange = vi.fn();
    const onValidity = vi.fn();
    render(<DateTimeField aria-label="Muddat" value="" onChange={onChange} onValidityChange={onValidity} />);
    const group = screen.getByRole("group", { name: "Muddat" });
    const date = screen.getByRole("textbox", { name: t("dateField.date") });
    const time = screen.getByRole("textbox", { name: t("dateField.time") });
    expect(group).toContainElement(date);

    await userEvent.type(date, "21102026");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-21T23:59");
    expect(time).toHaveAttribute("placeholder", "23:59");

    await userEvent.type(time, "0930");
    expect(onChange).toHaveBeenLastCalledWith("2026-10-21T09:30");
    expect(onValidity).toHaveBeenLastCalledWith(true);

    await userEvent.clear(time);
    await userEvent.type(time, "2575");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(onValidity).toHaveBeenLastCalledWith(false);
  });

  it("shows a prefilled datetime-local value", () => {
    render(<DateTimeField aria-label="Muddat" value="2026-10-21T14:30" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: t("dateField.date") })).toHaveValue("21.10.2026");
    expect(screen.getByRole("textbox", { name: t("dateField.time") })).toHaveValue("14:30");
  });
});
