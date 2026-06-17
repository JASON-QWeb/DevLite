import { DEFAULT_SETTINGS } from "./shared/defaults";
import { createTranslator, uiText } from "./shared/i18n";
import { getUiTheme, normalizeUiTheme, UI_THEMES } from "./shared/themes";
import type { DiagnosticSettings } from "./shared/types";
import "./ui/options.css";

const app = document.querySelector<HTMLDivElement>("#app");
let settings: DiagnosticSettings = DEFAULT_SETTINGS;
let toast = "";

void init();

async function init(): Promise<void> {
  const response = await sendMessage({ type: "get-settings" });
  if (response?.ok) {
    settings = response.settings;
  }
  render();
}

function render(): void {
  if (!app) return;
  const t = createTranslator(settings.locale);
  applyTheme(settings.uiTheme);
  app.innerHTML = `
    <main class="page">
      <header class="hero">
        <div class="hero-brand">
          <img class="hero-logo" src="/icons/devlite-ui-256.png" alt="" />
          <div>
            <h1>${t("optionsTitle")}</h1>
            <p>${t("optionsSubtitle")}</p>
          </div>
        </div>
        <button data-action="reset">${t("resetDefaults")}</button>
      </header>

      <div class="grid">
        <section class="section">
          <h2>${t("appearance")}</h2>
          <div class="body">
            <div class="theme-grid" role="radiogroup" aria-label="${t("theme")}">
              ${themeOption("claude", t("themeClaude"), settings.uiTheme)}
              ${themeOption("saas", t("themeSaas"), settings.uiTheme)}
              ${themeOption("dark", t("themeDark"), settings.uiTheme)}
              ${themeOption("cartoon", t("themeCartoon"), settings.uiTheme)}
            </div>
          </div>
        </section>

        <section class="section">
          <h2>${t("diagnosticCapture")}</h2>
          <div class="body">
            <label class="field">
              <span>${t("language")}</span>
              <select id="locale">
                <option value="zh" ${settings.locale === "zh" ? "selected" : ""}>中文</option>
                <option value="en" ${settings.locale === "en" ? "selected" : ""}>English</option>
              </select>
            </label>
            <label class="inline">
              <input id="collectResponseBody" type="checkbox" ${settings.collectResponseBody ? "checked" : ""} />
              <span>${t("collectResponse")}</span>
            </label>
            <label class="field">
              <span>${t("responseMaxLength")}</span>
              <input id="maxResponseLength" type="number" min="256" max="10000" step="256" value="${settings.maxResponseLength}" />
              <small>${t("responseNote")}</small>
            </label>
            <label class="field">
              <span>${t("slowThreshold")}</span>
              <input id="slowRequestThreshold" type="number" min="300" max="20000" step="100" value="${settings.slowRequestThreshold}" />
            </label>
            <label class="field">
              <span>${t("extraRedaction")}</span>
              <textarea id="extraRedactionKeys">${escapeHtml(settings.extraRedactionKeys.join("\n"))}</textarea>
              <small>${t("extraRedactionNote")}</small>
            </label>
          </div>
        </section>

      </div>

      <div class="actions">
        <button class="primary" data-action="save">${t("saveSettings")}</button>
        <button data-action="close">${t("close")}</button>
      </div>
    </main>
    ${toast ? `<div class="toast">${escapeHtml(toast)}</div>` : ""}
  `;
  bindEvents();
}

function themeOption(theme: DiagnosticSettings["uiTheme"], label: string, current: DiagnosticSettings["uiTheme"]): string {
  const tokens = UI_THEMES[theme].tokens;
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

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
    node.addEventListener("click", () => void handleAction(node.dataset.action ?? ""));
  });
  document.querySelectorAll<HTMLInputElement>('input[name="uiTheme"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) void handleThemeChange(input.value);
    });
  });
}

async function handleThemeChange(value: string): Promise<void> {
  const previous = settings;
  const next = {
    ...collectForm(),
    uiTheme: normalizeUiTheme(value)
  };
  settings = next;
  applyTheme(settings.uiTheme);
  const response = await sendMessage({ type: "save-settings", settings: next });
  if (response?.ok) {
    settings = response.settings;
  } else {
    settings = previous;
    showToast(response?.error || uiText(settings.locale, "saveFailed"));
  }
  render();
}

async function handleAction(action: string): Promise<void> {
  if (action === "save") {
    const next = collectForm();
    const response = await sendMessage({ type: "save-settings", settings: next });
    if (response?.ok) {
      settings = response.settings;
      showToast(uiText(settings.locale, "saved"));
    } else {
      showToast(response?.error || uiText(settings.locale, "saveFailed"));
    }
  }

  if (action === "reset") {
    settings = DEFAULT_SETTINGS;
    await sendMessage({ type: "save-settings", settings });
    showToast(uiText(settings.locale, "resetDone"));
  }

  if (action === "close") {
    window.close();
  }

  render();
}

function collectForm(): DiagnosticSettings {
  const locale = (document.querySelector<HTMLSelectElement>("#locale")?.value ?? DEFAULT_SETTINGS.locale) as DiagnosticSettings["locale"];
  const uiTheme = normalizeUiTheme(document.querySelector<HTMLInputElement>('input[name="uiTheme"]:checked')?.value ?? settings.uiTheme);
  const collectResponseBody = document.querySelector<HTMLInputElement>("#collectResponseBody")?.checked ?? false;
  const maxResponseLength = Number(document.querySelector<HTMLInputElement>("#maxResponseLength")?.value || DEFAULT_SETTINGS.maxResponseLength);
  const slowRequestThreshold = Number(document.querySelector<HTMLInputElement>("#slowRequestThreshold")?.value || DEFAULT_SETTINGS.slowRequestThreshold);
  const extraRedactionKeys = (document.querySelector<HTMLTextAreaElement>("#extraRedactionKeys")?.value ?? "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    ...settings,
    locale,
    uiTheme,
    collectResponseBody,
    maxResponseLength,
    slowRequestThreshold,
    extraRedactionKeys
  };
}

function applyTheme(theme: DiagnosticSettings["uiTheme"]): void {
  const definition = getUiTheme(theme);
  document.documentElement.dataset.theme = definition.id;
  Object.entries(definition.tokens).forEach(([key, value]) => {
    document.documentElement.style.setProperty(`--dl-${key}`, value);
  });
}

function sendMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

function showToast(message: string): void {
  toast = message;
  window.clearTimeout((showToast as any).timer);
  (showToast as any).timer = window.setTimeout(() => {
    toast = "";
    render();
  }, 2200);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}
