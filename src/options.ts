import { DEFAULT_SETTINGS } from "./shared/defaults";
import { createTranslator, uiText } from "./shared/i18n";
import type { AiSettings, DiagnosticSettings } from "./shared/types";
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
  app.innerHTML = `
    <main class="page">
      <header class="hero">
        <div class="hero-brand">
          <img class="hero-logo" src="/icons/devlite-128.png" alt="" />
          <div>
            <h1>${t("optionsTitle")}</h1>
            <p>${t("optionsSubtitle")}</p>
          </div>
        </div>
        <button data-action="reset">${t("resetDefaults")}</button>
      </header>

      <div class="grid">
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

        <section class="section">
          <h2>${t("aiMode")}</h2>
          <div class="body">
            <label class="field">
              <span>${t("mode")}</span>
              <select id="aiMode">
                <option value="off" ${settings.ai.mode === "off" ? "selected" : ""}>${t("off")}</option>
                <option value="user-key" ${settings.ai.mode === "user-key" ? "selected" : ""}>${t("userKey")}</option>
              </select>
            </label>
            <label class="field">
              <span>${t("provider")}</span>
              <select id="aiProvider">
                ${providerOption("openai", "OpenAI")}
                ${providerOption("deepseek", "DeepSeek")}
                ${providerOption("anthropic", "Anthropic")}
                ${providerOption("gemini", "Google Gemini")}
              </select>
            </label>
            <label class="field">
              <span>${t("model")}</span>
              <input id="aiModel" value="${escapeHtml(settings.ai.model)}" />
            </label>
            <label class="field">
              <span>API Key</span>
              <input id="aiApiKey" type="password" autocomplete="off" value="${escapeHtml(settings.ai.apiKey)}" />
            </label>
            <div class="note">
              ${t("apiKeyNote")}
            </div>
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

function providerOption(value: AiSettings["provider"], label: string): string {
  return `<option value="${value}" ${settings.ai.provider === value ? "selected" : ""}>${label}</option>`;
}

function bindEvents(): void {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((node) => {
    node.addEventListener("click", () => void handleAction(node.dataset.action ?? ""));
  });
  document.querySelector<HTMLSelectElement>("#aiProvider")?.addEventListener("change", (event) => {
    const provider = (event.target as HTMLSelectElement).value as AiSettings["provider"];
    const model = document.querySelector<HTMLInputElement>("#aiModel");
    if (model && !model.dataset.touched) {
      model.value = defaultModel(provider);
    }
  });
  document.querySelector<HTMLInputElement>("#aiModel")?.addEventListener("input", (event) => {
    (event.target as HTMLInputElement).dataset.touched = "true";
  });
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
  const collectResponseBody = document.querySelector<HTMLInputElement>("#collectResponseBody")?.checked ?? false;
  const maxResponseLength = Number(document.querySelector<HTMLInputElement>("#maxResponseLength")?.value || DEFAULT_SETTINGS.maxResponseLength);
  const slowRequestThreshold = Number(document.querySelector<HTMLInputElement>("#slowRequestThreshold")?.value || DEFAULT_SETTINGS.slowRequestThreshold);
  const extraRedactionKeys = (document.querySelector<HTMLTextAreaElement>("#extraRedactionKeys")?.value ?? "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const mode = (document.querySelector<HTMLSelectElement>("#aiMode")?.value ?? "off") as AiSettings["mode"];
  const provider = (document.querySelector<HTMLSelectElement>("#aiProvider")?.value ?? "openai") as AiSettings["provider"];
  const model = document.querySelector<HTMLInputElement>("#aiModel")?.value.trim() || defaultModel(provider);
  const apiKey = document.querySelector<HTMLInputElement>("#aiApiKey")?.value.trim() ?? "";

  return {
    ...settings,
    locale,
    collectResponseBody,
    maxResponseLength,
    slowRequestThreshold,
    extraRedactionKeys,
    ai: {
      mode,
      provider,
      model,
      apiKey
    }
  };
}

function defaultModel(provider: AiSettings["provider"]): string {
  const models: Record<AiSettings["provider"], string> = {
    openai: "gpt-4.1-mini",
    deepseek: "deepseek-chat",
    anthropic: "",
    gemini: "gemini-1.5-flash"
  };
  return models[provider];
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
