import { PANEL_THEMES } from "../panelConfig";
import { escapeHtml } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { PanelSettings, UiTheme } from "../types";

type SettingsTabContext = {
  settings: Required<PanelSettings>;
  t: (key: ContentTextKey) => string;
};

export function renderSettingsTabView({ settings, t }: SettingsTabContext): string {
  return `
      <div class="settings-panel">
        <section class="settings-card">
          <h3>${t("appearance")}</h3>
          <div class="theme-grid" role="radiogroup" aria-label="${t("theme")}">
            ${panelThemeOption("claude", t("themeClaude"), settings.uiTheme)}
            ${panelThemeOption("saas", t("themeSaas"), settings.uiTheme)}
            ${panelThemeOption("dark", t("themeDark"), settings.uiTheme)}
            ${panelThemeOption("cartoon", t("themeCartoon"), settings.uiTheme)}
          </div>
        </section>
        <section class="settings-card">
          <h3>${t("diagnosticSettings")}</h3>
          <div class="settings-fields">
            <label class="field">
              <span>${t("language")}</span>
              <select data-setting="locale">
                <option value="zh" ${settings.locale === "zh" ? "selected" : ""}>中文</option>
                <option value="en" ${settings.locale === "en" ? "selected" : ""}>English</option>
              </select>
            </label>
            <label class="inline setting-inline">
              <input data-setting="collectResponseBody" type="checkbox" ${settings.collectResponseBody ? "checked" : ""} />
              <span>${t("collectResponseBody")}</span>
            </label>
            <label class="field">
              <span>${t("responseMaxLength")}</span>
              <input data-setting="maxResponseLength" type="number" min="256" max="10000" step="256" value="${settings.maxResponseLength}" />
            </label>
            <label class="field">
              <span>${t("slowThreshold")}</span>
              <input data-setting="slowRequestThreshold" type="number" min="300" max="20000" step="100" value="${settings.slowRequestThreshold}" />
            </label>
            <label class="field full">
              <span>${t("extraRedaction")}</span>
              <textarea data-setting="extraRedactionKeys">${escapeHtml(settings.extraRedactionKeys.join("\n"))}</textarea>
            </label>
          </div>
        </section>
        <div class="settings-actions">
          <button data-action="save-panel-settings" class="primary">${t("saveSettings")}</button>
          <button data-action="reset-panel-settings">${t("resetDefaults")}</button>
        </div>
      </div>
    `;
}

function panelThemeOption(theme: UiTheme, label: string, current: UiTheme): string {
  const tokens = PANEL_THEMES[theme];
  return `
      <label class="theme-option">
        <input type="radio" name="uiTheme" value="${theme}" ${theme === current ? "checked" : ""} />
        <span class="theme-swatch" style="--swatch-bg:${tokens.bg};--swatch-surface:${tokens.surface};--swatch-primary:${tokens.primary};--swatch-border:${tokens.border};">
          <i></i><b></b>
        </span>
        <span>${label}</span>
      </label>
    `;
}
