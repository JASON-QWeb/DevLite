import { analyzeSession } from "../shared/analyzer";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../shared/defaults";
import { generateExport } from "../shared/exporters";
import { generateMarkdownReport } from "../shared/report";
import { sanitizeEvent, sanitizeSession } from "../shared/redaction";
import { normalizeUiTheme } from "../shared/themes";
import { sessionStore } from "./sessionStore";
import type {
  DiagnosticEvent,
  DiagnosticSession,
  DiagnosticSettings,
  ExportFormat,
  PageContext,
  StyleChange
} from "../shared/types";

const responseBodyCaptureTabs = new Set<number>();
const CONTENT_SCRIPT_ID = "devlite-content";
const MAIN_WORLD_SCRIPT_ID = "devlite-main-world-injected";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    if (!result[SETTINGS_KEY]) {
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    }
  });
  void registerMainWorldScript();
  void pruneExpiredSessions().catch((error) => console.warn("[DevLite] prune sessions failed", error));
});

chrome.runtime.onStartup.addListener(() => {
  void registerMainWorldScript();
  void pruneExpiredSessions().catch((error) => console.warn("[DevLite] prune sessions failed", error));
});

chrome.action.onClicked.addListener((tab) => {
  void openPagePanel(tab).catch((error) => {
    console.error("[DevLite] action click error", error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  responseBodyCaptureTabs.delete(tabId);
  void sessionStore.delete(tabId).catch((error) => console.warn("[DevLite] delete closed tab session failed", error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    responseBodyCaptureTabs.delete(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => safeSendResponse(sendResponse, response))
    .catch((error) => {
      console.error("[DevLite] background error", error);
      safeSendResponse(sendResponse, { ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

async function handleMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any> {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return { ok: false, error: "无效消息" };
  }
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
    const session = typeof tab.id === "number" ? await sessionStore.get(tab.id) : undefined;
    const settings = typeof tab.id === "number" ? await getTabSettings(tab.id) : await getSettings();
    return { ok: true, session: session ?? null, settings };
  }

  if (type === "get-tab-session") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    return { ok: true, session: (await sessionStore.get(tabId)) ?? null, settings: await getTabSettings(tabId) };
  }

  if (type === "ensure-session") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const tab = sender.tab;
    if (!tab) return { ok: false, error: "缺少 tab 信息" };
    const session = await sessionStore.update(tabId, (current) => {
      const next = current ?? createSession(tabId, message.page ?? createFallbackPageContext(tab));
      if (message.page) {
        next.page = {
          ...next.page,
          ...(message.page as PageContext),
          startedAt: next.page.startedAt
        };
      }
      next.updatedAt = Date.now();
      return next;
    });
    return { ok: true, session };
  }

  if (type === "start-page-capture") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const tab = sender.tab;
    await ensureInjectedScript(tabId);
    const page = message.page ?? (tab ? createFallbackPageContext(tab) : undefined);
    if (!page) return { ok: false, error: "缺少页面信息" };
    const session = await sessionStore.update(tabId, (current) => {
      const next = current ?? createSession(tabId, page as PageContext);
      next.active = true;
      next.page = {
        ...next.page,
        ...(page as PageContext),
        startedAt: next.page.startedAt
      };
      next.updatedAt = Date.now();
      return next;
    });
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
    await sessionStore.set(tab.id, session);
    await chrome.tabs.sendMessage(tab.id, { type: "devlite-start-capture", sessionId: session.id, settings });
    return { ok: true, session };
  }

  if (type === "stop-diagnosis") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    const session = await sessionStore.update(tab.id, (current) => {
      if (!current) return undefined;
      current.active = false;
      current.page.endedAt = Date.now();
      current.updatedAt = Date.now();
      return current;
    });
    await safeSendTabMessage(tab.id, { type: "devlite-stop-capture" });
    return { ok: true, session: session ?? null };
  }

  if (type === "start-inspector") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error("无法获取当前标签页");
    const tabId = tab.id;
    await ensurePageScripts(tabId);
    const session = await sessionStore.update(tabId, (current) => current ?? createSession(tabId, createFallbackPageContext(tab)));
    await chrome.tabs.sendMessage(tabId, { type: "devlite-start-inspector" });
    return { ok: true, session: session ?? null };
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
    await upsertEvent(tabId, event);
    return { ok: true };
  }

  if (type === "diagnostic-events") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    const settings = await getTabSettings(tabId);
    const events = Array.isArray(message.events) ? message.events : [];
    await upsertEvents(
      tabId,
      events.map((event: unknown) => sanitizeEvent(event as DiagnosticEvent, settings))
    );
    return { ok: true };
  }

  if (type === "page-context") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    await sessionStore.update(tabId, (session) => {
      if (!session) return undefined;
      session.page = {
        ...session.page,
        ...(message.page as PageContext),
        startedAt: session.page.startedAt
      };
      session.updatedAt = Date.now();
      return session;
    });
    return { ok: true };
  }

  if (type === "style-change-upsert") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    await upsertStyleChange(tabId, message.change as StyleChange);
    return { ok: true };
  }

  if (type === "style-change-delete") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    await deleteStyleChange(tabId, message.id);
    return { ok: true };
  }

  if (type === "clear-network-events") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: "缺少 tabId" };
    await clearNetworkEvents(tabId);
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
    id: `session-${tabId}-${randomId()}`,
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

async function upsertEvent(tabId: number, event: DiagnosticEvent): Promise<void> {
  await upsertEvents(tabId, [event]);
}

async function upsertEvents(tabId: number, events: DiagnosticEvent[]): Promise<void> {
  if (events.length === 0) return;
	  await sessionStore.update(tabId, (session) => {
	    if (!session) return undefined;
	    for (const event of events) {
	      session.events.push(event);
	    }
    if (session.events.length > 500) {
      session.events.splice(0, session.events.length - 500);
    }
    session.updatedAt = Date.now();
    return session;
  });
}

async function upsertStyleChange(tabId: number, change: StyleChange): Promise<void> {
  await sessionStore.update(tabId, (current) => {
    const session =
      current ??
      createSession(tabId, {
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
    return session;
  });
}

async function deleteStyleChange(tabId: number, id: string): Promise<void> {
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    session.styleChanges = session.styleChanges.filter((change) => change.id !== id);
    session.updatedAt = Date.now();
    return session;
  });
}

async function clearNetworkEvents(tabId: number): Promise<void> {
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    session.events = session.events.filter((event) => event.type !== "network");
    session.updatedAt = Date.now();
    return session;
  });
}

async function requireSession(tabId: number): Promise<DiagnosticSession> {
  const session = await sessionStore.get(tabId);
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
  if (!(await isContentScriptReady(tabId))) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
  await ensureInjectedScript(tabId);
}

async function isContentScriptReady(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "devlite-ping" });
    return response?.ok === true;
  } catch {
    return false;
  }
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
  if (!(await sessionStore.has(tab.id))) {
    await sessionStore.set(tab.id, createSession(tab.id, createFallbackPageContext(tab)));
  }
  await chrome.tabs.sendMessage(tab.id, { type: "devlite-open-panel" });
}

async function registerMainWorldScript(): Promise<void> {
  if (!chrome.scripting.registerContentScripts) return;
  try {
    const existing = new Set(
      (await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID, MAIN_WORLD_SCRIPT_ID] })).map((script) => script.id)
    );
    const scripts: chrome.scripting.RegisteredContentScript[] = [];
    if (!existing.has(CONTENT_SCRIPT_ID)) {
      scripts.push({
        id: CONTENT_SCRIPT_ID,
        matches: ["http://*/*", "https://*/*"],
        js: ["content.js"],
        runAt: "document_idle"
      });
    }
    if (!existing.has(MAIN_WORLD_SCRIPT_ID)) {
      scripts.push({
        id: MAIN_WORLD_SCRIPT_ID,
        matches: ["http://*/*", "https://*/*"],
        js: ["injected.js"],
        runAt: "document_start",
        world: "MAIN"
      });
    }
    if (scripts.length > 0) {
      await chrome.scripting.registerContentScripts(scripts);
    }
  } catch (error) {
    console.warn("[DevLite] register content scripts failed", error);
  }
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
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  await pruneExpiredSessions(merged).catch((error) => console.warn("[DevLite] prune sessions failed", error));
}

function mergeSettings(input?: Partial<DiagnosticSettings>): DiagnosticSettings {
  return {
    locale: input?.locale ?? DEFAULT_SETTINGS.locale,
    uiTheme: normalizeUiTheme(input?.uiTheme),
    collectResponseBody: input?.collectResponseBody ?? DEFAULT_SETTINGS.collectResponseBody,
    maxResponseLength: clampNumber(input?.maxResponseLength, 256, 10000, DEFAULT_SETTINGS.maxResponseLength),
    slowRequestThreshold: clampNumber(input?.slowRequestThreshold, 300, 20000, DEFAULT_SETTINGS.slowRequestThreshold),
    retainHours: clampNumber(input?.retainHours, 1, 24 * 30, DEFAULT_SETTINGS.retainHours),
    extraRedactionKeys: input?.extraRedactionKeys ?? DEFAULT_SETTINGS.extraRedactionKeys
  };
}

function safeSendResponse(sendResponse: (response?: any) => void, response: any): void {
  try {
    sendResponse(response);
  } catch (error) {
    console.warn("[DevLite] sendResponse failed", error);
  }
}

async function pruneExpiredSessions(settings?: DiagnosticSettings): Promise<void> {
  const retainHours = settings?.retainHours ?? (await getSettings()).retainHours;
  const cutoff = Date.now() - retainHours * 60 * 60 * 1000;
  await sessionStore.prune(cutoff);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
