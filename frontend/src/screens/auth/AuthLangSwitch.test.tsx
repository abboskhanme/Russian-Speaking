/**
 * The UZ · RU · EN switch on the auth pages: the only way to change the language
 * before signing in. It must switch the UI at once and persist the choice the
 * same way the profile switch does (localStorage `govori_lang`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n, { setLang } from "../../shared/i18n";
import { AuthLangSwitch } from "./AuthLangSwitch";

afterEach(() => {
  setLang("uz");
  localStorage.clear();
});

describe("AuthLangSwitch", () => {
  it("marks the current language and switches + persists on click", async () => {
    setLang("uz");
    render(<AuthLangSwitch />);
    expect(screen.getByRole("button", { name: "O‘zbekcha" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Русский" }));
    expect(i18n.language).toBe("ru");
    expect(localStorage.getItem("govori_lang")).toBe("ru");
    expect(screen.getByRole("button", { name: "Русский" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Язык интерфейса" })).toBeInTheDocument();
  });
});
