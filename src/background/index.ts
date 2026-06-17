import { analyzeSession } from "../shared/analyzer";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../shared/defaults";
import { generateExport } from "../shared/exporters";
import { generateMarkdownReport } from "../shared/report";
import { sanitizeEvent, sanitizeSession } from "../shared/redaction";
import type {
  DiagnosticEvent,
  DiagnosticSession,
  DiagnosticSettings,
  ExportFormat,
  PageContext,
  StyleChange
} from "../shared/types";

const sessions = new Map<number, DiagnosticSession>();
const responseBodyCaptureTabs = new Set<number>();

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
    const settings = typeof tab.id === "number" ? await getTabSettings(tab.id) : await getSettings();
    return { ok: true, session: session ?? null, settings };
  }

  if (type === "get-tab-session") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    return { ok: true, session: sessions.get(tabId) ?? null, settings: await getTabSettings(tabId) };
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
    return { ok: true, session, settings: await getTabSettings(tabId) };
  }

  if (type === "enable-tab-response-body") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    responseBodyCaptureTabs.add(tabId);
    return { ok: true, settings: await getTabSettings(tabId) };
  }

  if (type === "start-diagnosis") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    await ensurePageScripts(tab.id);
    const settings = await getTabSettings(tab.id);
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
    const settings = await getTabSettings(tabId);
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
    const settings = await getTabSettings(tabId);
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
    const settings = await getTabSettings(tabId);
    const safeSession = sanitizeSession(session, settings);
    return { ok: true, text: generateExport(safeSession, settings, message.format as ExportFormat) };
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

async function getTabSettings(tabId: number): Promise<DiagnosticSettings> {
  const settings = await getSettings();
  return responseBodyCaptureTabs.has(tabId)
    ? {
        ...settings,
        collectResponseBody: true
      }
    : settings;
}

async function saveSettings(settings: DiagnosticSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: mergeSettings(settings) });
}

function mergeSettings(input?: Partial<DiagnosticSettings>): DiagnosticSettings {
  return {
    locale: input?.locale ?? DEFAULT_SETTINGS.locale,
    collectResponseBody: input?.collectResponseBody ?? DEFAULT_SETTINGS.collectResponseBody,
    maxResponseLength: input?.maxResponseLength ?? DEFAULT_SETTINGS.maxResponseLength,
    slowRequestThreshold: input?.slowRequestThreshold ?? DEFAULT_SETTINGS.slowRequestThreshold,
    retainHours: input?.retainHours ?? DEFAULT_SETTINGS.retainHours,
    extraRedactionKeys: input?.extraRedactionKeys ?? DEFAULT_SETTINGS.extraRedactionKeys
  };
}
