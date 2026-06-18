import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { IconContext } from "@phosphor-icons/react";
import "./index.css";
import App from "./App";
import { SystemActionsProvider } from "./contexts/SystemActions";
import { I18nProvider } from "./i18n";
import { exposePluginSDK } from "./plugins";
import { ThemeProvider } from "./themes";
import { HERMES_BASE_PATH } from "./lib/api";

// Expose the plugin SDK before rendering so plugins loaded via <script>
// can access React, components, etc. immediately.
exposePluginSDK();

// Pre-paint the Liquid-Glass body marker before the React tree mounts so a
// fresh load is light + frosted with no flash. ThemeProvider re-asserts this
// from applyTheme once it resolves the active theme.
try {
  const storedTheme =
    window.localStorage.getItem("hermes-dashboard-theme") ?? "rolefit";
  document.body.dataset.rfGlass = storedTheme === "rolefit" ? "true" : "false";
} catch {
  document.body.dataset.rfGlass = "true";
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={HERMES_BASE_PATH || undefined}>
    <IconContext.Provider value={{ weight: "regular" }}>
      <I18nProvider>
        <ThemeProvider>
          <SystemActionsProvider>
            <App />
          </SystemActionsProvider>
        </ThemeProvider>
      </I18nProvider>
    </IconContext.Provider>
  </BrowserRouter>,
);
