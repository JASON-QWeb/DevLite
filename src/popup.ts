import { analyzeSession } from "./shared/analyzer";
import { createTranslator, uiText } from "./shared/i18n";
import type { AnalysisResult, DiagnosticSession, DiagnosticSettings, ExportFormat } from "./shared/types";
import "./ui/popup.css";

type PopupState = {
  session: DiagnosticSession | null;
  settings: DiagnosticSettings | null;
  report: string;
  analysis: AnalysisResult | null;
  aiPreview: string;
  aiResult: string;
  busy: boolean;
  toast: string;
};

const state: PopupState = {
  session: null,
  settings: null,
  report: "",
  analysis: null,
  aiPreview: "",
  aiResult: "",
  busy: false,
  toast: ""
};

const app = document.querySelector<HTMLDivElement>("#app");

void init();

async function init(): Promise<void> {
  await refresh();
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
  const settings = state.settings;
  const aiReady = settings?.ai.mode === "user-key" && !!settings.ai.apiKey;
  const t = createTranslator(settings?.locale);

  app.innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="/icons/devlite-128.png" alt="" />
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

        <div class="section">
          <div class="section-header">
            <h2>${t("export")}</h2>
          </div>
          <div class="section-body exports">
            <button data-export="ai">AI Prompt</button>
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

        <div class="section">
          <div class="section-header">
            <h2>${t("aiAnalysis")}</h2>
            <button class="ghost" data-action="options">${t("settings")}</button>
          </div>
          <div class="section-body">
            ${
              aiReady
                ? `<button class="primary" data-action="ai-preview">${t("generateAiPreview")}</button>`
                : `<div class="empty">${t("localAiNote")}</div>`
            }
            ${state.aiPreview ? renderAiPreview() : ""}
            ${state.aiResult ? `<div class="ai-result">${escapeHtml(state.aiResult)}</div>` : ""}
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
        <button class="ghost" data-action="options">${t("openSettings")}</button>
      </footer>
    </main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;

  bindEvents();
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
            <code>${escapeHtml(Object.entries(change.after).map(([key, value]) => `${key}: ${value}`).join("; "))}</code>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

function renderAiPreview(): string {
  const t = createTranslator(state.settings?.locale);
  return `
    <textarea readonly>${escapeHtml(state.aiPreview)}</textarea>
    <div class="preview-actions">
      <button class="primary" data-action="ai-run">${t("confirmSendAi")}</button>
      <button data-action="ai-cancel">${t("cancel")}</button>
    </div>
  `;
}

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
    node.addEventListener("click", () => void handleAction(node.dataset.action ?? ""));
  });
  document.querySelectorAll<HTMLElement>("[data-export]").forEach((node) => {
    node.addEventListener("click", () => void copyExport(node.dataset.export as ExportFormat));
  });
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

    if (action === "options") {
      chrome.runtime.openOptionsPage();
    }

    if (action === "ai-preview") {
      const response = await sendMessage({ type: "generate-export", format: "ai" });
      if (!response?.ok) throw new Error(response?.error || t("previewFailed"));
      state.aiPreview = response.text;
      state.aiResult = "";
      showToast(t("aiPreviewReady"));
    }

    if (action === "ai-cancel") {
      state.aiPreview = "";
      showToast(t("aiCancelled"));
    }

    if (action === "ai-run") {
      if (state.settings?.ai.provider) {
        await requestAiPermission(state.settings.ai.provider);
      }
      const response = await sendMessage({ type: "run-ai-analysis" });
      if (!response?.ok) throw new Error(response?.error || t("aiFailed"));
      state.aiResult = response.result.content;
      state.aiPreview = "";
      showToast(t("aiDone"));
    }

    await refresh();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    state.busy = false;
    render();
  }
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
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

function requestAiPermission(provider: string): Promise<void> {
  const origins: Record<string, string[]> = {
    openai: ["https://api.openai.com/*"],
    deepseek: ["https://api.deepseek.com/*"],
    anthropic: ["https://api.anthropic.com/*"],
    gemini: ["https://generativelanguage.googleapis.com/*"]
  };

  return new Promise((resolve, reject) => {
    chrome.permissions.request({ origins: origins[provider] ?? [] }, (granted) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!granted) {
        reject(new Error(uiText(state.settings?.locale, "aiFailed")));
        return;
      }
      resolve();
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
