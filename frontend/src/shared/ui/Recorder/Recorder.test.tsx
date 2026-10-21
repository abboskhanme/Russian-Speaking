/**
 * The recorder's "why can't I record" states. On a plain-http origin browsers hide
 * `navigator.mediaDevices`, which used to read as "your device doesn't support
 * microphone recording" — on phones that do. Each cause now has its own words.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "../../i18n";
import { Recorder, classifyMediaError } from "./Recorder";

const t = (k: string) => i18n.t(k);

function setEnv({ secure, media }: { secure: boolean; media?: MediaDevices }) {
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: media, configurable: true });
  if (media) Object.defineProperty(window, "MediaRecorder", { value: class {}, configurable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).MediaRecorder;
});

describe("classifyMediaError", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["PermissionDeniedError", "denied"],
    ["NotFoundError", "noDevice"],
    ["NotReadableError", "busy"],
    ["SomethingElse", "generic"],
  ])("%s → %s", (name, kind) => {
    expect(classifyMediaError(new DOMException("x", name))).toBe(kind);
  });
});

describe("Recorder environment", () => {
  it("says HTTPS is required on an insecure origin, not that the device can't record", () => {
    setEnv({ secure: false });
    render(<Recorder onComplete={() => undefined} />);
    expect(screen.getByText(t("recorder.insecureTitle"))).toBeInTheDocument();
    expect(screen.queryByText(t("recorder.unsupportedHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("recorder.start") })).not.toBeInTheDocument();
  });

  it("keeps the unsupported-browser message for a secure page without the API", () => {
    setEnv({ secure: true });
    render(<Recorder onComplete={() => undefined} />);
    expect(screen.getByText(t("recorder.unsupportedTitle"))).toBeInTheDocument();
  });

  it("explains a denied permission and offers to ask again", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("no", "NotAllowedError"));
    setEnv({ secure: true, media: { getUserMedia } as unknown as MediaDevices });
    render(<Recorder onComplete={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: t("recorder.start") }));
    expect(await screen.findByText(t("recorder.deniedTitle"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("recorder.retry") }));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("docked: portals the ONE mic + the aside into the host's bar", () => {
    setEnv({ secure: true, media: { getUserMedia: vi.fn() } as unknown as MediaDevices });
    const bar = document.createElement("div");
    document.body.appendChild(bar);
    render(
      <Recorder onComplete={() => undefined} dockTarget={bar} dockAside={<button>skip-it</button>} />,
    );
    expect(screen.getAllByRole("button", { name: t("recorder.start") })).toHaveLength(1);
    expect(bar).toContainElement(screen.getByRole("button", { name: t("recorder.start") }));
    expect(bar).toContainElement(screen.getByRole("button", { name: "skip-it" }));
    bar.remove();
  });
});
