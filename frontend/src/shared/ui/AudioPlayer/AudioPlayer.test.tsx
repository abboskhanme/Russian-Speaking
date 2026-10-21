import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../i18n";
import { AudioPlayer, formatClock, peaksFrom } from "./AudioPlayer";

const t = i18n.getFixedT("uz", "common");

function audioEl(container: HTMLElement): HTMLAudioElement {
  const a = container.querySelector("audio");
  if (!a) throw new Error("no <audio>");
  return a;
}

/** jsdom's media element has no real duration; give it one and fire the event. */
function loadMetadata(a: HTMLAudioElement, duration: number) {
  Object.defineProperty(a, "duration", { configurable: true, value: duration });
  fireEvent.loadedMetadata(a);
}

describe("AudioPlayer", () => {
  it("shows the caller's 'unavailable' text when there is no recording", () => {
    render(<AudioPlayer src={null} unavailableLabel="Yozuv muddati tugagan" />);
    expect(screen.getByRole("status")).toHaveTextContent("Yozuv muddati tugagan");
    expect(screen.queryByRole("button", { name: t("audioPlayer.play") })).not.toBeInTheDocument();
  });

  it("plays and pauses from one labelled button", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container } = render(<AudioPlayer src="https://x.test/a.webm" />);
    const a = audioEl(container);

    await userEvent.click(screen.getByRole("button", { name: t("audioPlayer.play") }));
    expect(play).toHaveBeenCalled();
    fireEvent.play(a);
    Object.defineProperty(a, "paused", { configurable: true, value: false });
    await userEvent.click(screen.getByRole("button", { name: t("audioPlayer.pause") }));
    expect(pause).toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
  });

  it("scrubs through an accessible slider that announces the position", () => {
    const { container } = render(<AudioPlayer src="https://x.test/a.webm" />);
    const a = audioEl(container);
    loadMetadata(a, 45);
    const slider = screen.getByRole("slider", { name: t("audioPlayer.seek") });
    expect(slider).toHaveAttribute("aria-valuetext", "0:00 / 0:45");
    fireEvent.change(slider, { target: { value: "12" } });
    expect(a.currentTime).toBe(12);
    expect(slider).toHaveAttribute("aria-valuetext", "0:12 / 0:45");
  });

  it("toggles 1× ⇄ 0.75× and applies it to the element", async () => {
    const { container } = render(<AudioPlayer src="https://x.test/a.webm" />);
    const a = audioEl(container);
    const btn = screen.getByRole("button", { name: t("audioPlayer.speed", { rate: "1×" }) });
    await userEvent.click(btn);
    expect(a.playbackRate).toBe(0.75);
    expect(screen.getByRole("button", { name: t("audioPlayer.speed", { rate: "0,75×" }) })).toBeInTheDocument();
  });

  it("turns a load error into 'recording unavailable' with a working retry", async () => {
    const { container } = render(<AudioPlayer src="https://x.test/gone.webm" />);
    fireEvent.error(audioEl(container));
    expect(screen.getByRole("status")).toHaveTextContent(t("audioPlayer.unavailable"));
    await userEvent.click(screen.getByRole("button", { name: t("audioPlayer.retry") }));
    expect(screen.getByRole("button", { name: t("audioPlayer.play") })).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("formats a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75.4)).toBe("1:15");
    expect(formatClock(Infinity)).toBe("0:00");
  });

  it("buckets samples into normalised peaks", () => {
    const s = new Float32Array([0, 0.5, -0.25, 0.1, 0, -1]);
    expect(peaksFrom(s, 3)).toEqual([0.5, 0.25, 1]);
    expect(peaksFrom(new Float32Array(0), 2)).toEqual([0, 0]);
  });
});
