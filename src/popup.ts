import { analyzeSession } from "./shared/analyzer";
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
    state.analysis = state.session && state.settings ? analyzeSession(state.session, state.settings.slowRequestThreshold) : null;
  }
}

function render(): void {
  if (!app) return;
  const active = !!state.session?.active;
  const analysis = state.analysis;
  const settings = state.settings;
  const aiReady = settings?.ai.mode === "user-key" && !!settings.ai.apiKey;

  app.innerHTML = `
    <main class="app">
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="/icons/devlite-128.png" alt="" />
          <div>
            <h1>DevLite</h1>
            <span>简易版检查模式</span>
          </div>
        </div>
        <span class="status ${active ? "active" : ""}">${active ? "诊断中" : "未启动"}</span>
      </header>

      <section class="content">
        <div class="section">
          <div class="section-header">
            <h2>操作</h2>
          </div>
          <div class="section-body actions">
            ${
              active
                ? `<button class="danger" data-action="stop">停止诊断</button>`
                : `<button class="primary" data-action="start">开始诊断</button>`
            }
            <button data-action="inspect">选择元素</button>
            <button data-action="report">生成报告</button>
            <button data-action="copy-report" ${state.report ? "" : "disabled"}>复制报告</button>
          </div>
          <div class="metrics">
            ${metric(analysis?.counters.jsErrors ?? 0, "JS")}
            ${metric(analysis?.counters.failedRequests ?? 0, "请求")}
            ${metric(analysis?.counters.resourceErrors ?? 0, "资源")}
            ${metric(state.session?.styleChanges.length ?? 0, "样式")}
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <h2>导出</h2>
          </div>
          <div class="section-body exports">
            <button data-export="ai">AI Prompt</button>
            <button data-export="markdown">Markdown</button>
            <button data-export="json">JSON</button>
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <h2>样式修改</h2>
            <span>${state.session?.styleChanges.length ?? 0}</span>
          </div>
          <div class="section-body">
            ${renderStyleChanges(state.session)}
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <h2>AI 分析</h2>
            <button class="ghost" data-action="options">设置</button>
          </div>
          <div class="section-body">
            ${
              aiReady
                ? `<button class="primary" data-action="ai-preview">生成发送预览</button>`
                : `<div class="empty">默认使用本地规则分析。需要 AI 时，在设置页配置自己的 API Key。</div>`
            }
            ${state.aiPreview ? renderAiPreview() : ""}
            ${state.aiResult ? `<div class="ai-result">${escapeHtml(state.aiResult)}</div>` : ""}
          </div>
        </div>

        ${
          state.report
            ? `<div class="section">
                <div class="section-header"><h2>报告</h2></div>
                <div class="section-body">
                  <textarea readonly>${escapeHtml(state.report)}</textarea>
                </div>
              </div>`
            : ""
        }
      </section>

      <footer class="footer">
        <button class="ghost" data-action="refresh">刷新状态</button>
        <button class="ghost" data-action="options">打开设置</button>
      </footer>
    </main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;

  bindEvents();
}

function metric(value: number, label: string): string {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderStyleChanges(session: DiagnosticSession | null): string {
  const changes = session?.styleChanges ?? [];
  if (changes.length === 0) {
    return `<div class="empty">还没有 CSS 修改。点击「选择元素」后可实时调整页面样式。</div>`;
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
  return `
    <textarea readonly>${escapeHtml(state.aiPreview)}</textarea>
    <div class="preview-actions">
      <button class="primary" data-action="ai-run">确认发送给 AI</button>
      <button data-action="ai-cancel">取消</button>
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
  try {
    if (action === "start") {
      const response = await sendMessage({ type: "start-diagnosis" });
      if (!response?.ok) throw new Error(response?.error || "启动失败");
      showToast("已开始诊断当前页面");
    }

    if (action === "stop") {
      const response = await sendMessage({ type: "stop-diagnosis" });
      if (!response?.ok) throw new Error(response?.error || "停止失败");
      showToast("诊断已停止");
    }

    if (action === "inspect") {
      const response = await sendMessage({ type: "start-inspector" });
      if (!response?.ok) throw new Error(response?.error || "无法启动元素选择器");
      showToast("请在页面中点击元素");
      window.close();
    }

    if (action === "report") {
      await generateReport();
      showToast("报告已生成");
    }

    if (action === "copy-report") {
      if (!state.report) await generateReport();
      await copyText(state.report);
      showToast("报告已复制");
    }

    if (action === "refresh") {
      await refresh();
      showToast("状态已刷新");
    }

    if (action === "options") {
      chrome.runtime.openOptionsPage();
    }

    if (action === "ai-preview") {
      const response = await sendMessage({ type: "generate-export", format: "ai" });
      if (!response?.ok) throw new Error(response?.error || "生成预览失败");
      state.aiPreview = response.text;
      state.aiResult = "";
    }

    if (action === "ai-cancel") {
      state.aiPreview = "";
    }

    if (action === "ai-run") {
      if (state.settings?.ai.provider) {
        await requestAiPermission(state.settings.ai.provider);
      }
      const response = await sendMessage({ type: "run-ai-analysis" });
      if (!response?.ok) throw new Error(response?.error || "AI 分析失败");
      state.aiResult = response.result.content;
      state.aiPreview = "";
      showToast("AI 分析完成");
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
  if (!response?.ok) throw new Error(response?.error || "生成报告失败");
  state.report = response.report;
  state.analysis = response.analysis;
  state.session = response.session;
}

async function copyExport(format: ExportFormat): Promise<void> {
  try {
    const response = await sendMessage({ type: "generate-export", format });
    if (!response?.ok) throw new Error(response?.error || "导出失败");
    await copyText(response.text);
    showToast(`${format} 已复制`);
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
        reject(new Error("未授权访问所选 AI 服务接口"));
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
