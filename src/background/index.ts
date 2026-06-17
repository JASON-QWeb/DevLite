import { analyzeSession } from "../shared/analyzer";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../shared/defaults";
import { generateExport } from "../shared/exporters";
import { generateMarkdownReport } from "../shared/report";
import { sanitizeEvent, sanitizeSession } from "../shared/redaction";
import type {
  AiAnalysisResult,
  AiSettings,
  DiagnosticEvent,
  DiagnosticSession,
  DiagnosticSettings,
  ExportFormat,
  PageContext,
  StyleChange
} from "../shared/types";

const sessions = new Map<number, DiagnosticSession>();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    if (!result[SETTINGS_KEY]) {
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  void openPagePanel(tab).catch((error) => {
    console.error("[DevLite] action click error", error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[DevLite] background error", error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  const type = message?.type;

  if (type === "get-settings") {
    return { ok: true, settings: await getSettings() };
  }

  if (type === "save-settings") {
    await saveSettings(message.settings);
    return { ok: true, settings: await getSettings() };
  }

  if (type === "get-current-session") {
    const tab = await getActiveTab();
    const session = typeof tab.id === "number" ? sessions.get(tab.id) : undefined;
    return { ok: true, session: session ?? null, settings: await getSettings() };
  }

  if (type === "get-tab-session") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    return { ok: true, session: sessions.get(tabId) ?? null, settings: await getSettings() };
  }

  if (type === "ensure-session") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const tab = sender.tab;
    if (!tab) return { ok: false, error: "缺少 tab 信息" };
    const session = sessions.get(tabId) ?? createSession(tabId, message.page ?? createFallbackPageContext(tab));
    if (message.page) {
      session.page = {
        ...session.page,
        ...(message.page as PageContext),
        startedAt: session.page.startedAt
      };
    }
    session.updatedAt = Date.now();
    sessions.set(tabId, session);
    return { ok: true, session };
  }

  if (type === "start-page-capture") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const tab = sender.tab;
    await ensureInjectedScript(tabId);
    const page = message.page ?? (tab ? createFallbackPageContext(tab) : undefined);
    if (!page) return { ok: false, error: "缺少页面信息" };
    const session = sessions.get(tabId) ?? createSession(tabId, page as PageContext);
    session.active = true;
    session.page = {
      ...session.page,
      ...(page as PageContext),
      startedAt: session.page.startedAt
    };
    session.updatedAt = Date.now();
    sessions.set(tabId, session);
    return { ok: true, session, settings: await getSettings() };
  }

  if (type === "start-diagnosis") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    await ensurePageScripts(tab.id);
    const settings = await getSettings();
    const session = createSession(tab.id, message.page ?? createFallbackPageContext(tab));
    sessions.set(tab.id, session);
    await chrome.tabs.sendMessage(tab.id, { type: "devlite-start-capture", sessionId: session.id, settings });
    return { ok: true, session };
  }

  if (type === "stop-diagnosis") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    const session = sessions.get(tab.id);
    if (session) {
      session.active = false;
      session.page.endedAt = Date.now();
      session.updatedAt = Date.now();
    }
    await safeSendTabMessage(tab.id, { type: "devlite-stop-capture" });
    return { ok: true, session: session ?? null };
  }

  if (type === "start-inspector") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    await ensurePageScripts(tab.id);
    if (!sessions.has(tab.id)) {
      sessions.set(tab.id, createSession(tab.id, createFallbackPageContext(tab)));
    }
    await chrome.tabs.sendMessage(tab.id, { type: "devlite-start-inspector" });
    return { ok: true, session: sessions.get(tab.id) ?? null };
  }

  if (type === "stop-inspector") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    await safeSendTabMessage(tab.id, { type: "devlite-stop-inspector" });
    return { ok: true };
  }

  if (type === "diagnostic-event") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const settings = await getSettings();
    const event = sanitizeEvent(message.event as DiagnosticEvent, settings);
    upsertEvent(tabId, event);
    return { ok: true };
  }

  if (type === "page-context") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const session = sessions.get(tabId);
    if (session) {
      session.page = {
        ...session.page,
        ...(message.page as PageContext),
        startedAt: session.page.startedAt
      };
      session.updatedAt = Date.now();
    }
    return { ok: true };
  }

  if (type === "style-change-upsert") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    upsertStyleChange(tabId, message.change as StyleChange);
    return { ok: true };
  }

  if (type === "style-change-delete") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    deleteStyleChange(tabId, message.id);
    return { ok: true };
  }

  if (type === "generate-report") {
    const tabId = await getSessionTabId(sender);
    const session = await requireSession(tabId);
    const settings = await getSettings();
    const safeSession = sanitizeSession(session, settings);
    return {
      ok: true,
      report: generateMarkdownReport(safeSession, settings),
      analysis: analyzeSession(safeSession, settings.slowRequestThreshold, settings.locale),
      session: safeSession
    };
  }

  if (type === "generate-export") {
    const tabId = await getSessionTabId(sender);
    const session = await requireSession(tabId);
    const settings = await getSettings();
    const safeSession = sanitizeSession(session, settings);
    return { ok: true, text: generateExport(safeSession, settings, message.format as ExportFormat) };
  }

  if (type === "run-ai-analysis") {
    const tabId = await getSessionTabId(sender);
    const session = await requireSession(tabId);
    const settings = await getSettings();
    const safeSession = sanitizeSession(session, settings);
    const result = await runAiAnalysis(safeSession, settings);
    return { ok: true, result };
  }

  if (type === "open-options") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  return { ok: false, error: `未知消息类型：${type}` };
}

function createSession(tabId: number, page: PageContext): DiagnosticSession {
  const now = Date.now();
  return {
    id: `session-${tabId}-${now}`,
    tabId,
    active: true,
    page: { ...page, startedAt: now },
    events: [],
    styleChanges: [],
    createdAt: now,
    updatedAt: now
  };
}

function createFallbackPageContext(tab: chrome.tabs.Tab): PageContext {
  return {
    url: tab.url ?? "",
    title: tab.title ?? "",
    userAgent: "unknown",
    language: "unknown",
    viewport: {
      width: 0,
      height: 0,
      devicePixelRatio: 1
    },
    startedAt: Date.now()
  };
}

function upsertEvent(tabId: number, event: DiagnosticEvent): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.events.push(event);
  if (session.events.length > 500) {
    session.events.splice(0, session.events.length - 500);
  }
  session.updatedAt = Date.now();
}

function upsertStyleChange(tabId: number, change: StyleChange): void {
  const session = sessions.get(tabId) ?? createSession(tabId, {
    url: "",
    title: "",
    userAgent: "unknown",
    language: "unknown",
    viewport: {
      ...change.viewport,
      devicePixelRatio: 1
    },
    startedAt: Date.now()
  });
  const index = session.styleChanges.findIndex((item) => item.id === change.id);
  if (index >= 0) {
    session.styleChanges[index] = change;
  } else {
    session.styleChanges.push(change);
  }
  session.updatedAt = Date.now();
  sessions.set(tabId, session);
}

function deleteStyleChange(tabId: number, id: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.styleChanges = session.styleChanges.filter((change) => change.id !== id);
  session.updatedAt = Date.now();
}

async function requireSession(tabId: number): Promise<DiagnosticSession> {
  const session = sessions.get(tabId);
  if (!session) {
    throw new Error("当前页面还没有诊断数据，请先开始诊断或使用元素选择器。");
  }
  return session;
}

async function getSessionTabId(sender: chrome.runtime.MessageSender): Promise<number> {
  if (typeof sender.tab?.id === "number" && /^https?:\/\//.test(sender.tab.url ?? "")) {
    return sender.tab.id;
  }
  const tab = await getActiveTab();
  if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
  return tab.id;
}

async function ensurePageScripts(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
  await ensureInjectedScript(tabId);
}

async function ensureInjectedScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["injected.js"],
    world: "MAIN"
  });
}

async function openPagePanel(tab: chrome.tabs.Tab): Promise<void> {
  if (typeof tab.id !== "number") return;
  if (!isInjectableUrl(tab.url)) return;
  await ensurePageScripts(tab.id);
  if (!sessions.has(tab.id)) {
    sessions.set(tab.id, createSession(tab.id, createFallbackPageContext(tab)));
  }
  await chrome.tabs.sendMessage(tab.id, { type: "devlite-open-panel" });
}

function isInjectableUrl(url = ""): boolean {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

async function safeSendTabMessage(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // The page may have navigated or the script may not be available yet.
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("无法获取当前标签页");
  }
  return tab;
}

async function getSettings(): Promise<DiagnosticSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY]);
}

async function saveSettings(settings: DiagnosticSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: mergeSettings(settings) });
}

function mergeSettings(input?: Partial<DiagnosticSettings>): DiagnosticSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(input ?? {}),
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...(input?.ai ?? {})
    },
    extraRedactionKeys: input?.extraRedactionKeys ?? DEFAULT_SETTINGS.extraRedactionKeys
  };
}

async function runAiAnalysis(session: DiagnosticSession, settings: DiagnosticSettings): Promise<AiAnalysisResult> {
  if (settings.ai.mode !== "user-key" || !settings.ai.apiKey.trim()) {
    throw new Error("请先在设置页启用用户 API Key 并填写密钥。");
  }
  if (!settings.ai.model.trim()) {
    throw new Error("请先在设置页填写模型 ID。");
  }

  await requestAiPermission(settings.ai.provider);

  const prompt = generateExport(session, settings, "ai");
  const content = await callAiProvider(settings.ai, prompt);

  return {
    provider: settings.ai.provider,
    model: settings.ai.model,
    content,
    createdAt: Date.now()
  };
}

async function requestAiPermission(provider: AiSettings["provider"]): Promise<void> {
  const origins: Record<AiSettings["provider"], string[]> = {
    openai: ["https://api.openai.com/*"],
    deepseek: ["https://api.deepseek.com/*"],
    anthropic: ["https://api.anthropic.com/*"],
    gemini: ["https://generativelanguage.googleapis.com/*"]
  };

  const granted = await chrome.permissions.request({ origins: origins[provider] });
  if (!granted) {
    throw new Error("用户未授权访问所选 AI 服务接口。");
  }
}

async function callAiProvider(ai: AiSettings, prompt: string): Promise<string> {
  if (ai.provider === "openai" || ai.provider === "deepseek") {
    const baseUrl = ai.provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ai.apiKey}`
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: "system", content: "你是资深前端问题诊断和代码实现助手。请基于 DevLite 报告给出可执行修复建议。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });
    const json = await parseJsonResponse(response);
    return json.choices?.[0]?.message?.content ?? JSON.stringify(json, null, 2);
  }

  if (ai.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ai.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const json = await parseJsonResponse(response);
    return json.content?.map((item: any) => item.text).filter(Boolean).join("\n") ?? JSON.stringify(json, null, 2);
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent?key=${encodeURIComponent(ai.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });
  const json = await parseJsonResponse(response);
  return json.candidates?.[0]?.content?.parts?.map((item: any) => item.text).filter(Boolean).join("\n") ?? JSON.stringify(json, null, 2);
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(json.error?.message || json.message || `AI 请求失败：${response.status}`);
  }
  return json;
}
