import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";

// Styles — load once at the app root so every `var(--…)` resolves.
//   1. fonts.css   — self-hosted @font-face (Onest + JetBrains Mono).
//   2. index.css   — Tailwind base + legacy globals/utilities.
//   3. tokens.css  — Ovoz DS tokens; imported LAST so its :root light defaults
//                    win the cascade and dark mode (data-theme) drives the app.
import "./shared/styles/fonts.css";
import "./index.css";
import "./shared/styles/tokens.css";

import i18n from "./shared/i18n"; // side-effect: initializes i18next
import { applyTheme, getStoredTheme } from "./widgets";
import { AuthProvider } from "./shared/auth";
import App from "./App";

// Reflect the stored theme (or follow the OS when unset) before first paint.
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </I18nextProvider>
  </React.StrictMode>,
);
