import { analyzeSession } from "./shared/analyzer";
import { DEFAULT_SETTINGS } from "./shared/defaults";
import { createTranslator, uiText } from "./shared/i18n";
import { getUiTheme, normalizeUiTheme, UI_THEMES } from "./shared/themes";
import type { AnalysisResult, DiagnosticSession, DiagnosticSettings, ExportFormat } from "./shared/types";
import "./ui/popup.css";

type PopupState = {
  session: DiagnosticSession | null;
  settings: DiagnosticSettings | null;
  report: string;
  analysis: AnalysisResult | null;
  busy: boolean;
  showSettings: boolean;
  toast: string;
};

const state: PopupState = {
  session: null,
  settings: null,
  report: "",
  analysis: null,
  busy: false,
  showSettings: false,
  toast: ""
};

const app = document.querySelector<HTMLDivElement>("#app");

void init();

async function init(): Promise<void> {
  await refresh().catch((error) => {
    showToast(error instanceof Error ? error.message : String(error));
  });
  render();
}

async function refresh(): Promise<void> {
  const response = await sendMessage({ type: "get-current-session" });
  if (response?.ok) {
    state.session = response.session;
    state.settings = response.settings;
    state.analysis = state.session && state.settings ? analyzeSession(state.session, state.settings.slowRequestThreshold, state.settings.locale) : null;
  }
}

function render(): void {
  if (!app) return;
  const active = !!state.session?.active;
  const analysis = state.analysis;
  const settings = state.settings ?? DEFAULT_SETTINGS;
  const t = createTranslator(settings?.locale);
  applyTheme(settings.uiTheme);
  document.documentElement.lang = settings.locale === "en" ? "en" : "zh-CN";

  app.innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="/icons/devlite-ui-256.png" alt="" />
          <div>
            <h1>DevLite</h1>
            <span>${t("subtitle")}</span>
          </div>
        </div>
        <span class="status ${active ? "active" : ""}">${active ? t("active") : t("inactive")}</span>
      </header>

      <section class="content">
        <div class="section">
          <div class="section-header">
            <h2>${t("actions")}</h2>
          </div>
          <div class="section-body actions">
            ${
              active
                ? `<button class="danger" data-action="stop">${t("stopDiagnosis")}</button>`
                : `<button class="primary" data-action="start">${t("startDiagnosis")}</button>`
            }
            <button data-action="open-panel">${t("openPanel")}</button>
            <button data-action="inspect">${t("inspect")}</button>
            <button data-action="report">${t("generateReport")}</button>
            <button data-action="copy-report" ${state.report ? "" : "disabled"}>${t("copyReport")}</button>
          </div>
          <div class="metrics">
            ${metric(analysis?.counters.jsErrors ?? 0, "JS")}
            ${metric(analysis?.counters.failedRequests ?? 0, t("requests"))}
            ${metric(analysis?.counters.resourceErrors ?? 0, t("resources"))}
            ${metric(state.session?.styleChanges.length ?? 0, t("styles"))}
          </div>
        </div>

        ${state.showSettings ? renderSettings(settings, t) : ""}

        <div class="section">
          <div class="section-header">
            <h2>${t("export")}</h2>
          </div>
          <div class="section-body exports">
            <button data-export="prompt">${t("repairPrompt")}</button>
            <button data-export="markdown">Markdown</button>
            <button data-export="json">JSON</button>
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <h2>${t("styleChanges")}</h2>
            <span>${state.session?.styleChanges.length ?? 0}</span>
          </div>
          <div class="section-body">
            ${renderStyleChanges(state.session, t("emptyStyleChanges"))}
          </div>
        </div>

        ${
          state.report
            ? `<div class="section">
                <div class="section-header"><h2>${t("report")}</h2></div>
                <div class="section-body">
                  <textarea readonly>${escapeHtml(state.report)}</textarea>
                </div>
              </div>`
            : ""
        }
      </section>

      <footer class="footer">
        <button class="ghost" data-action="refresh">${t("refreshStatus")}</button>
        <button class="ghost" data-action="toggle-settings">${t("openSettings")}</button>
      </footer>
    </main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;

  bindEvents();
}

function renderSettings(settings: DiagnosticSettings, t: ReturnType<typeof createTranslator>): string {
  return `
    <div class="section settings-section">
      <div class="section-header">
        <h2>${t("inlineSettings")}</h2>
        <button class="text-button" data-action="reset-settings">${t("resetDefaults")}</button>
      </div>
      <div class="section-body settings-body">
        <div class="settings-group">
          <strong>${t("appearance")}</strong>
          <div class="theme-grid" role="radiogroup" aria-label="${t("theme")}">
            ${themeOption("claude", t("themeClaude"), settings.uiTheme)}
            ${themeOption("saas", t("themeSaas"), settings.uiTheme)}
            ${themeOption("dark", t("themeDark"), settings.uiTheme)}
            ${themeOption("cartoon", t("themeCartoon"), settings.uiTheme)}
          </div>
        </div>
        <div class="settings-group compact">
          <strong>${t("diagnosticSettings")}</strong>
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
          </label>
          <label class="field">
            <span>${t("slowThreshold")}</span>
            <input id="slowRequestThreshold" type="number" min="300" max="20000" step="100" value="${settings.slowRequestThreshold}" />
          </label>
          <label class="field">
            <span>${t("extraRedaction")}</span>
            <textarea id="extraRedactionKeys">${escapeHtml(settings.extraRedactionKeys.join("\n"))}</textarea>
          </label>
        </div>
        <button class="primary" data-action="save-settings">${t("saveSettings")}</button>
      </div>
    </div>
  `;
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

function metric(value: number, label: string): string {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderStyleChanges(session: DiagnosticSession | null, emptyText: string): string {
  const changes = session?.styleChanges ?? [];
  if (changes.length === 0) {
    return `<div class="empty">${emptyText}</div>`;
  }
  return `
    <div class="list">
      ${changes
        .slice()
        .reverse()
        .map(
          (change) => `
          <div class="item">
            <strong>${escapeHtml(change.elementLabel)}</strong>
            <code>${escapeHtml(change.selector)}</code>
            <code>${escapeHtml(summarizeChange(change))}</code>
          </div>
        `
        )
        .join("")}
    </div>
	  `;
}

function summarizeChange(change: DiagnosticSession["styleChanges"][number]): string {
  const parts = Object.entries(change.after).map(([key, value]) => `${key}: ${value}`);
  if (change.textAfter !== undefined && change.textAfter !== (change.textBefore ?? "")) {
    parts.push("textContent");
  }
  if (change.domAfter !== undefined && change.domAfter !== (change.domBefore ?? "")) {
    parts.push(change.domAction ?? "DOM");
  }
  return parts.join("; ");
}

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
    node.addEventListener("click", () => void handleAction(node.dataset.action ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-export]").forEach((node) => {
    node.addEventListener("click", () => void copyExport(node.dataset.export as ExportFormat));
  });
  document.querySelectorAll<HTMLInputElement>('input[name="uiTheme"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) void handleThemeChange(input.value);
    });
  });
}

async function handleThemeChange(value: string): Promise<void> {
  const current = state.settings ?? DEFAULT_SETTINGS;
  const next = {
    ...collectSettingsForm(),
    uiTheme: normalizeUiTheme(value)
  };
  state.settings = next;
  applyTheme(next.uiTheme);
  try {
    const response = await sendMessage({ type: "save-settings", settings: next });
    if (!response?.ok) throw new Error(response?.error || uiText(current.locale, "saveFailed"));
    state.settings = response.settings;
  } catch (error) {
    state.settings = current;
    showToast(error instanceof Error ? error.message : String(error));
  }
  render();
}

async function handleAction(action: string): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  const t = createTranslator(state.settings?.locale);
  try {
    if (action === "start") {
      const response = await sendMessage({ type: "start-diagnosis" });
      if (!response?.ok) throw new Error(response?.error || t("startFailed"));
      showToast(t("started"));
    }

    if (action === "stop") {
      const response = await sendMessage({ type: "stop-diagnosis" });
      if (!response?.ok) throw new Error(response?.error || t("stopFailed"));
      showToast(t("stopped"));
    }

    if (action === "inspect") {
      const response = await sendMessage({ type: "start-inspector" });
      if (!response?.ok) throw new Error(response?.error || t("inspectFailed"));
      showToast(t("clickElement"));
      window.close();
    }

    if (action === "open-panel") {
      const response = await sendMessage({ type: "open-page-panel" });
      if (!response?.ok) throw new Error(response?.error || t("openPanelFailed"));
      window.close();
    }

    if (action === "report") {
      await generateReport();
      showToast(t("reportGenerated"));
    }

    if (action === "copy-report") {
      if (!state.report) await generateReport();
      await copyText(state.report);
      showToast(t("reportCopied"));
    }

    if (action === "refresh") {
      await refresh();
      showToast(t("refreshed"));
    }

    if (action === "toggle-settings") {
      state.showSettings = !state.showSettings;
    }

    if (action === "save-settings") {
      const next = collectSettingsForm();
      const response = await sendMessage({ type: "save-settings", settings: next });
      if (!response?.ok) throw new Error(response?.error || t("saveFailed"));
      state.settings = response.settings;
      state.analysis =
        state.session && state.settings ? analyzeSession(state.session, state.settings.slowRequestThreshold, state.settings.locale) : null;
      showToast(uiText(state.settings?.locale, "saved"));
    }

    if (action === "reset-settings") {
      const response = await sendMessage({ type: "save-settings", settings: DEFAULT_SETTINGS });
      if (!response?.ok) throw new Error(response?.error || t("saveFailed"));
      state.settings = response.settings;
      state.analysis =
        state.session && state.settings ? analyzeSession(state.session, state.settings.slowRequestThreshold, state.settings.locale) : null;
      showToast(uiText(state.settings?.locale, "resetDone"));
    }

    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
}

function collectSettingsForm(): DiagnosticSettings {
  const current = state.settings ?? DEFAULT_SETTINGS;
  const locale = (document.querySelector<HTMLSelectElement>("#locale")?.value ?? current.locale) as DiagnosticSettings["locale"];
  const uiTheme = normalizeUiTheme(document.querySelector<HTMLInputElement>('input[name="uiTheme"]:checked')?.value ?? current.uiTheme);
  const collectResponseBody = document.querySelector<HTMLInputElement>("#collectResponseBody")?.checked ?? false;
  const maxResponseLength = clampNumber(document.querySelector<HTMLInputElement>("#maxResponseLength")?.value, 256, 10000, current.maxResponseLength);
  const slowRequestThreshold = clampNumber(document.querySelector<HTMLInputElement>("#slowRequestThreshold")?.value, 300, 20000, current.slowRequestThreshold);
  const extraRedactionKeys = (document.querySelector<HTMLTextAreaElement>("#extraRedactionKeys")?.value ?? "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    ...current,
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

async function generateReport(): Promise<void> {
  const response = await sendMessage({ type: "generate-report" });
  if (!response?.ok) throw new Error(response?.error || uiText(state.settings?.locale, "reportFailed"));
  state.report = response.report;
  state.analysis = response.analysis;
  state.session = response.session;
}

async function copyExport(format: ExportFormat): Promise<void> {
  const t = createTranslator(state.settings?.locale);
  try {
    const response = await sendMessage({ type: "generate-export", format });
    if (!response?.ok) throw new Error(response?.error || t("exportFailed"));
    await copyText(response.text);
    showToast(`${format} ${t("copied")}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    render();
  }
}

function sendMessage(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function showToast(message: string): void {
  state.toast = message;
  window.clearTimeout((showToast as any).timer);
  (showToast as any).timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
