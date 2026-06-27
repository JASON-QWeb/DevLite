import { analyzeSession } from "../shared/analyzer";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../shared/defaults";
import { generateExport } from "../shared/exporters";
import { generateMarkdownReport } from "../shared/report";
import { sanitizeEvent, sanitizeSession } from "../shared/redaction";
import { normalizeUiTheme } from "../shared/themes";
import { isStaleDiagnosticScopeEvent, type DiagnosticScope } from "../shared/diagnosticScope";
import { sessionStore } from "./sessionStore";
import type {
  DiagnosticEvent,
  DiagnosticSession,
  DiagnosticSettings,
  ExportFormat,
  PageContext,
  StyleChangeArchiveReason,
  StyleChangeVerificationStatus,
  StyleChange
} from "../shared/types";

const responseBodyCaptureTabs = new Set<number>();
const LEGACY_CONTENT_SCRIPT_ID = "devlite-content";
const MAIN_WORLD_SCRIPT_ID = "devlite-main-world-injected";
const OPEN_SOURCE_URL = "https://github.com/JASON-QWeb/DevLite";
const ICONIFY_API_URL = "https://api.iconify.design";
const ICONIFY_REQUEST_TIMEOUT = 8000;
let settingsCache: DiagnosticSettings | null = null;
const BACKGROUND_TEXT = {
  zh: {
    invalidMessage: "无效消息",
    invalidIconifyIcon: "无效 Iconify 图标",
    iconifySearchFailed: "在线素材加载失败",
    iconifySvgFailed: "图标加载失败",
    missingTabId: "缺少 tabId",
    missingTabInfo: "缺少 tab 信息",
    missingPageInfo: "缺少页面信息",
    activeTabUnavailable: "无法获取当前标签页",
    noSession: "当前页面还没有诊断数据，请先开始诊断或使用元素选择器。",
    unsupportedPagePanel: "当前页面不支持打开 DevLite 面板",
    unknownMessage: "未知消息类型"
  },
  en: {
    invalidMessage: "Invalid message",
    invalidIconifyIcon: "Invalid Iconify icon",
    iconifySearchFailed: "Could not load online assets",
    iconifySvgFailed: "Could not load icon",
    missingTabId: "Missing tabId",
    missingTabInfo: "Missing tab information",
    missingPageInfo: "Missing page information",
    activeTabUnavailable: "Could not get the current tab",
    noSession: "This page does not have diagnostic data yet. Start diagnostics or use the element selector first.",
    unsupportedPagePanel: "The current page does not support opening the DevLite panel",
    unknownMessage: "Unknown message type"
  }
} as const;

type BackgroundTextKey = keyof typeof BACKGROUND_TEXT.zh;

type IconifyIconAsset = {
  id: string;
  prefix: string;
  name: string;
  label: string;
  svg: string;
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    if (!result[SETTINGS_KEY]) {
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
      settingsCache = DEFAULT_SETTINGS;
    }
  });
  void registerMainWorldScript();
  void pruneExpiredSessions().catch((error) => console.warn("[DevLite] prune sessions failed", error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
  settingsCache = mergeSettings(changes[SETTINGS_KEY].newValue as Partial<DiagnosticSettings> | undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void registerMainWorldScript();
  void pruneExpiredSessions().catch((error) => console.warn("[DevLite] prune sessions failed", error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  responseBodyCaptureTabs.delete(tabId);
  void sessionStore.delete(tabId).catch((error) => console.warn("[DevLite] delete closed tab session failed", error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    void reconcileTabNavigation(tabId, changeInfo.url ?? tab.url).catch((error) => console.warn("[DevLite] reconcile tab navigation failed", error));
  }
});

chrome.action.onClicked.addListener((tab) => {
  void openPagePanel(tab).catch((error) => console.warn("[DevLite] open panel from toolbar failed", error));
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
    return { ok: false, error: await backgroundText("invalidMessage") };
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
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    await reconcileTabNavigation(tabId, sender.tab?.url);
    return { ok: true, session: (await sessionStore.get(tabId)) ?? null, settings: await getTabSettings(tabId) };
  }

  if (type === "ensure-session") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    const tab = sender.tab;
    if (!tab) return { ok: false, error: await backgroundText("missingTabInfo") };
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
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    const tab = sender.tab;
    await ensureInjectedScript(tabId);
    const page = message.page ?? (tab ? createFallbackPageContext(tab) : undefined);
    if (!page) return { ok: false, error: await backgroundText("missingPageInfo") };
    const diagnosticScope = normalizeDiagnosticScope(message.diagnosticScope);
    const session = await sessionStore.update(tabId, (current) => {
      const next = current ?? createSession(tabId, page as PageContext);
      next.active = true;
      next.page = {
        ...next.page,
        ...(page as PageContext),
        startedAt: next.page.startedAt
      };
      if (responseBodyCaptureTabs.has(tabId) || current?.collectResponseBody) {
        next.collectResponseBody = true;
      }
      if (diagnosticScope) {
        applyDiagnosticScopeReset(next, diagnosticScope);
      }
      next.updatedAt = Date.now();
      return next;
    });
    return { ok: true, session, settings: await getTabSettings(tabId) };
  }

  if (type === "enable-tab-response-body") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    responseBodyCaptureTabs.add(tabId);
    await sessionStore.update(tabId, (session) => {
      if (!session) return undefined;
      session.collectResponseBody = true;
      session.updatedAt = Date.now();
      return session;
    });
    return { ok: true, settings: await getTabSettings(tabId) };
  }

  if (type === "start-diagnosis") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error(await backgroundText("activeTabUnavailable"));
    await ensurePageScripts(tab.id);
    const settings = await getTabSettings(tab.id);
    const session = createSession(tab.id, message.page ?? createFallbackPageContext(tab));
    if (settings.collectResponseBody) {
      session.collectResponseBody = true;
    }
    await sessionStore.set(tab.id, session);
    await chrome.tabs.sendMessage(tab.id, { type: "devlite-start-capture", sessionId: session.id, settings });
    return { ok: true, session };
  }

  if (type === "stop-diagnosis") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error(await backgroundText("activeTabUnavailable"));
    responseBodyCaptureTabs.delete(tab.id);
    const session = await sessionStore.update(tab.id, (current) => {
      if (!current) return undefined;
      current.active = false;
      current.collectResponseBody = false;
      current.page.endedAt = Date.now();
      current.updatedAt = Date.now();
      return current;
    });
    await safeSendTabMessage(tab.id, { type: "devlite-stop-capture" });
    return { ok: true, session: session ?? null };
  }

  if (type === "start-inspector") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error(await backgroundText("activeTabUnavailable"));
    const tabId = tab.id;
    await ensurePageScripts(tabId);
    const session = await sessionStore.update(tabId, (current) => current ?? createSession(tabId, createFallbackPageContext(tab)));
    await chrome.tabs.sendMessage(tabId, { type: "devlite-start-inspector" });
    return { ok: true, session: session ?? null };
  }

  if (type === "stop-inspector") {
    const tab = await getActiveTab();
    if (typeof tab.id !== "number") throw new Error(await backgroundText("activeTabUnavailable"));
    await safeSendTabMessage(tab.id, { type: "devlite-stop-inspector" });
    return { ok: true };
  }

  if (type === "diagnostic-event") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    const settings = await getTabSettings(tabId);
    const event = sanitizeEvent(message.event as DiagnosticEvent, settings);
    await upsertEvent(tabId, event);
    return { ok: true };
  }

  if (type === "diagnostic-events") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    const settings = await getTabSettings(tabId);
    const events = Array.isArray(message.events) ? message.events : [];
    await upsertEvents(
      tabId,
      events.map((event: unknown) => sanitizeEvent(event as DiagnosticEvent, settings))
    );
    return { ok: true };
  }

  if (type === "reset-diagnostic-scope") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    const diagnosticScope = normalizeDiagnosticScope(message.diagnosticScope);
    if (!diagnosticScope) return { ok: false, error: await backgroundText("invalidMessage") };
    const session = await resetDiagnosticScope(tabId, diagnosticScope);
    return { ok: true, session: session ?? null };
  }

  if (type === "page-context") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
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
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    await upsertStyleChange(tabId, message.change as StyleChange);
    return { ok: true };
  }

  if (type === "style-change-delete") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    await deleteStyleChange(tabId, message.id);
    return { ok: true };
  }

  if (type === "style-changes-mark-exported") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    await markStyleChangesExported(tabId, Array.isArray(message.ids) ? message.ids : [], {
      pageLoadId: message.pageLoadId,
      mutationVersion: message.mutationVersion,
      reason: message.reason
    });
    return { ok: true };
  }

  if (type === "style-change-verification-update") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    await updateStyleChangeVerification(tabId, message.id, message.status, message.reason);
    return { ok: true };
  }

  if (type === "style-changes-archive") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
    await archiveStyleChanges(tabId, Array.isArray(message.ids) ? message.ids : [], message.reason, message.verificationReason);
    return { ok: true };
  }

  if (type === "clear-network-events") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") return { ok: false, error: await backgroundText("missingTabId") };
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

  if (type === "iconify-search") {
    return searchIconifyIcons(message);
  }

  if (type === "iconify-svg") {
    return fetchIconifyIcon(message);
  }

  if (type === "open-options") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  if (type === "open-page-panel") {
    const tab = await getActiveTab();
    const opened = await openPagePanel(tab);
    return opened ? { ok: true } : { ok: false, error: await backgroundText("unsupportedPagePanel") };
  }

  if (type === "open-source-page") {
    await chrome.tabs.create({ url: OPEN_SOURCE_URL });
    return { ok: true };
  }

  return { ok: false, error: `${await backgroundText("unknownMessage")}: ${type}` };
}

async function searchIconifyIcons(message: any): Promise<any> {
  const queries = normalizeStringList(message.queries ?? message.query, 6, 64);
  const prefixes = normalizeStringList(message.prefixes, 10, 32).filter(isIconifyName);
  const limit = clampNumber(message.limit, 1, 24, 18);
  if (queries.length === 0) return { ok: true, icons: [] };

  try {
    const iconIds: string[] = [];
    for (const query of queries) {
      const ids = await fetchIconifySearchIds(query);
      iconIds.push(...ids);
    }

    const firstSeen = new Map<string, number>();
    for (const id of iconIds) {
      if (splitIconifyId(id) && !firstSeen.has(id)) {
        firstSeen.set(id, firstSeen.size);
      }
    }

    const rankedIds = Array.from(firstSeen.keys()).sort((a, b) => {
      const aPrefix = splitIconifyId(a)?.prefix ?? "";
      const bPrefix = splitIconifyId(b)?.prefix ?? "";
      const aPrefixRank = preferredPrefixRank(prefixes, aPrefix);
      const bPrefixRank = preferredPrefixRank(prefixes, bPrefix);
      return aPrefixRank - bPrefixRank || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
    });

    const candidates = rankedIds.slice(0, Math.max(limit * 2, limit));
    const icons: IconifyIconAsset[] = [];
    for (const icon of await Promise.all(candidates.map(fetchIconifyAsset))) {
      if (icon) icons.push(icon);
      if (icons.length >= limit) break;
    }
    return { ok: true, icons };
  } catch (error) {
    console.warn("[DevLite] iconify search failed", error);
    return { ok: false, error: await backgroundText("iconifySearchFailed") };
  }
}

async function fetchIconifyIcon(message: any): Promise<any> {
  const prefix = typeof message.prefix === "string" ? message.prefix.trim() : "";
  const name = typeof message.name === "string" ? message.name.trim() : "";
  if (!isIconifyName(prefix) || !isIconifyName(name)) {
    return { ok: false, error: await backgroundText("invalidIconifyIcon") };
  }

  try {
    const svg = await fetchIconifySvg(prefix, name);
    return { ok: true, icon: { id: `${prefix}:${name}`, prefix, name, label: iconifyLabel(name), svg } };
  } catch (error) {
    console.warn("[DevLite] iconify svg failed", error);
    return { ok: false, error: await backgroundText("iconifySvgFailed") };
  }
}

async function fetchIconifySearchIds(query: string): Promise<string[]> {
  const url = new URL(`${ICONIFY_API_URL}/search`);
  url.searchParams.set("query", query);
  const data = await fetchJsonWithTimeout(url.toString());
  const icons = (data as { icons?: unknown[] }).icons;
  return Array.isArray(icons) ? icons.filter((item): item is string => typeof item === "string" && splitIconifyId(item) !== null) : [];
}

async function fetchIconifyAsset(id: string): Promise<IconifyIconAsset | null> {
  const parsed = splitIconifyId(id);
  if (!parsed) return null;
  try {
    const svg = await fetchIconifySvg(parsed.prefix, parsed.name);
    return {
      id: `${parsed.prefix}:${parsed.name}`,
      prefix: parsed.prefix,
      name: parsed.name,
      label: iconifyLabel(parsed.name),
      svg
    };
  } catch {
    return null;
  }
}

async function fetchIconifySvg(prefix: string, name: string): Promise<string> {
  if (!isIconifyName(prefix) || !isIconifyName(name)) {
    throw new Error(await backgroundText("invalidIconifyIcon"));
  }
  const url = `${ICONIFY_API_URL}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
  const svg = await fetchTextWithTimeout(url, "image/svg+xml");
  if (!/^<svg[\s>]/i.test(svg.trim())) {
    throw new Error(await backgroundText("iconifySvgFailed"));
  }
  return svg;
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const text = await fetchTextWithTimeout(url, "application/json");
  return JSON.parse(text);
}

async function fetchTextWithTimeout(url: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ICONIFY_REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().replace(/\s+/g, " ").slice(0, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function splitIconifyId(id: string): { prefix: string; name: string } | null {
  const separatorIndex = id.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex !== id.lastIndexOf(":")) return null;
  const prefix = id.slice(0, separatorIndex);
  const name = id.slice(separatorIndex + 1);
  return isIconifyName(prefix) && isIconifyName(name) ? { prefix, name } : null;
}

function isIconifyName(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

function preferredPrefixRank(prefixes: string[], prefix: string): number {
  const rank = prefixes.indexOf(prefix);
  return rank >= 0 ? rank : prefixes.length + 1;
}

function iconifyLabel(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
    archivedStyleChanges: [],
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
    const acceptedEvents = events.filter((event) => !session.diagnosticScope || !isStaleDiagnosticScopeEvent(event, session.diagnosticScope));
    if (acceptedEvents.length === 0) return session;
    for (const event of acceptedEvents) {
      session.events.push(event);
    }
    if (session.events.length > 500) {
      session.events.splice(0, session.events.length - 500);
    }
    session.updatedAt = Date.now();
    return session;
  });
}

async function resetDiagnosticScope(tabId: number, diagnosticScope: DiagnosticScope): Promise<DiagnosticSession | undefined> {
  return sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    applyDiagnosticScopeReset(session, diagnosticScope);
    return session;
  });
}

function applyDiagnosticScopeReset(session: DiagnosticSession, diagnosticScope: DiagnosticScope): void {
  session.diagnosticScope = diagnosticScope;
  session.events = (session.events ?? []).filter((event) => !isStaleDiagnosticScopeEvent(event, diagnosticScope));
  session.updatedAt = Date.now();
}

function normalizeDiagnosticScope(value: unknown): DiagnosticScope | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.pageLoadId !== "string" || input.pageLoadId.length === 0) return null;
  const diagnosticGeneration = typeof input.diagnosticGeneration === "number" ? input.diagnosticGeneration : NaN;
  const mutationVersion = typeof input.mutationVersion === "number" ? input.mutationVersion : NaN;
  const updatedAt = typeof input.updatedAt === "number" ? input.updatedAt : NaN;
  if (!Number.isFinite(diagnosticGeneration) || !Number.isFinite(mutationVersion)) return null;
  return {
    pageLoadId: input.pageLoadId,
    diagnosticGeneration,
    mutationVersion,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    reason: typeof input.reason === "string" ? input.reason : undefined
  };
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
    session.styleChanges ??= [];
    session.archivedStyleChanges ??= [];
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
    session.styleChanges ??= [];
    session.styleChanges = session.styleChanges.filter((change) => change.id !== id);
    session.updatedAt = Date.now();
    return session;
  });
}

async function markStyleChangesExported(
  tabId: number,
  ids: string[],
  metadata: { pageLoadId?: string; mutationVersion?: number; reason?: string }
): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const now = Date.now();
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    session.styleChanges ??= [];
    session.archivedStyleChanges ??= [];
    session.styleChanges = session.styleChanges.map((change) => {
      if (!idSet.has(change.id)) return change;
      return {
        ...change,
        exportedAt: change.exportedAt ?? now,
        exportedPageLoadId: metadata.pageLoadId,
        exportedMutationVersion: metadata.mutationVersion,
        verificationStatus: "waiting",
        lastVerifiedAt: now,
        lastVerifyReason: metadata.reason || "Waiting for page refresh or hot update"
      };
    });
    session.updatedAt = now;
    return session;
  });
}

async function updateStyleChangeVerification(
  tabId: number,
  id: string,
  status: StyleChangeVerificationStatus,
  reason: string
): Promise<void> {
  if (status !== "waiting" && status !== "failed") return;
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    session.styleChanges ??= [];
    const index = session.styleChanges.findIndex((change) => change.id === id);
    if (index < 0) return session;
    session.styleChanges[index] = {
      ...session.styleChanges[index],
      verificationStatus: status,
      lastVerifiedAt: Date.now(),
      lastVerifyReason: reason
    };
    session.updatedAt = Date.now();
    return session;
  });
}

async function archiveStyleChanges(
  tabId: number,
  ids: string[],
  reason: StyleChangeArchiveReason,
  verificationReason?: string
): Promise<void> {
  if (ids.length === 0 || (reason !== "verified" && reason !== "manual")) return;
  const idSet = new Set(ids);
  const now = Date.now();
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    session.styleChanges ??= [];
    session.archivedStyleChanges ??= [];
    const archived = session.styleChanges.filter((change) => idSet.has(change.id));
    if (archived.length === 0) return session;
    session.styleChanges = session.styleChanges.filter((change) => !idSet.has(change.id));
    const existing = new Set(session.archivedStyleChanges.map((item) => item.change.id));
    for (const change of archived) {
      if (existing.has(change.id)) continue;
      session.archivedStyleChanges.push({
        change: {
          ...change,
          verificationStatus: undefined,
          lastVerifiedAt: now,
          lastVerifyReason: verificationReason
        },
        archivedAt: now,
        archiveReason: reason,
        verificationReason
      });
    }
    session.updatedAt = now;
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

async function reconcileTabNavigation(tabId: number, nextUrl?: string): Promise<void> {
  if (!nextUrl) return;
  const session = await sessionStore.get(tabId);
  if (!session) {
    responseBodyCaptureTabs.delete(tabId);
    return;
  }
  if (!session.active) {
    responseBodyCaptureTabs.delete(tabId);
    return;
  }
  if (!isInjectableUrl(nextUrl) || !isSameOriginUrl(session.page.url, nextUrl)) {
    responseBodyCaptureTabs.delete(tabId);
    await deactivateTabSession(tabId);
  }
}

async function deactivateTabSession(tabId: number): Promise<void> {
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    session.active = false;
    session.collectResponseBody = false;
    session.page.endedAt = Date.now();
    session.updatedAt = Date.now();
    return session;
  });
}

function isSameOriginUrl(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

async function requireSession(tabId: number): Promise<DiagnosticSession> {
  const session = await sessionStore.get(tabId);
  if (!session) {
    throw new Error(await backgroundText("noSession"));
  }
  return session;
}

async function getSessionTabId(sender: chrome.runtime.MessageSender): Promise<number> {
  if (typeof sender.tab?.id === "number" && /^https?:\/\//.test(sender.tab.url ?? "")) {
    return sender.tab.id;
  }
  const tab = await getActiveTab();
  if (typeof tab.id !== "number") throw new Error(await backgroundText("activeTabUnavailable"));
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

async function openPagePanel(tab: chrome.tabs.Tab): Promise<boolean> {
  if (typeof tab.id !== "number") return false;
  if (!isInjectableUrl(tab.url)) return false;
  await ensurePageScripts(tab.id);
  if (!(await sessionStore.has(tab.id))) {
    await sessionStore.set(tab.id, createSession(tab.id, createFallbackPageContext(tab)));
  }
  await chrome.tabs.sendMessage(tab.id, { type: "devlite-open-panel" });
  return true;
}

async function registerMainWorldScript(): Promise<void> {
  if (!chrome.scripting.registerContentScripts) return;
  try {
    const existing = new Set(
      (await chrome.scripting.getRegisteredContentScripts({ ids: [LEGACY_CONTENT_SCRIPT_ID, MAIN_WORLD_SCRIPT_ID] })).map((script) => script.id)
    );
    if (existing.has(LEGACY_CONTENT_SCRIPT_ID)) {
      await chrome.scripting.unregisterContentScripts({ ids: [LEGACY_CONTENT_SCRIPT_ID] });
    }
    const scripts: chrome.scripting.RegisteredContentScript[] = [];
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
    throw new Error(await backgroundText("activeTabUnavailable"));
  }
  return tab;
}

async function getSettings(): Promise<DiagnosticSettings> {
  if (settingsCache) return settingsCache;
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const rawSettings = result[SETTINGS_KEY] as Partial<DiagnosticSettings> | undefined;
  const settings = mergeSettings(rawSettings);
  settingsCache = settings;
  if (needsSettingsMigration(rawSettings, settings)) {
    void chrome.storage.local.set({ [SETTINGS_KEY]: settings }).catch((error) => console.warn("[DevLite] settings migration failed", error));
  }
  return settings;
}

async function backgroundText(key: BackgroundTextKey): Promise<string> {
  let locale = DEFAULT_SETTINGS.locale;
  try {
    locale = (await getSettings()).locale;
  } catch (error) {
    console.warn("[DevLite] load settings for background text failed", error);
  }
  return BACKGROUND_TEXT[locale]?.[key] ?? BACKGROUND_TEXT[DEFAULT_SETTINGS.locale][key];
}

async function getTabSettings(tabId: number): Promise<DiagnosticSettings> {
  const settings = await getSettings();
  const session = await sessionStore.get(tabId);
  const collectResponseBody = responseBodyCaptureTabs.has(tabId) || (session?.active === true && session.collectResponseBody === true);
  return collectResponseBody
    ? {
        ...settings,
        collectResponseBody: true
      }
    : settings;
}

async function saveSettings(settings: DiagnosticSettings): Promise<void> {
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  settingsCache = merged;
  await pruneExpiredSessions(merged).catch((error) => console.warn("[DevLite] prune sessions failed", error));
}

function mergeSettings(input?: Partial<DiagnosticSettings>): DiagnosticSettings {
  return {
    locale: input?.locale ?? DEFAULT_SETTINGS.locale,
    uiTheme: normalizeUiTheme(input?.uiTheme),
    collectResponseBody: input?.collectResponseBody ?? DEFAULT_SETTINGS.collectResponseBody,
    maxResponseLength: clampNumber(input?.maxResponseLength, 256, 10000, DEFAULT_SETTINGS.maxResponseLength),
    slowRequestThreshold: clampNumber(input?.slowRequestThreshold, 300, 20000, DEFAULT_SETTINGS.slowRequestThreshold),
    performanceTtfbWarning: clampNumber(input?.performanceTtfbWarning, 100, 10000, DEFAULT_SETTINGS.performanceTtfbWarning),
    performanceTtfbError: clampNumber(input?.performanceTtfbError, 100, 20000, DEFAULT_SETTINGS.performanceTtfbError),
    performanceDomReadyWarning: clampNumber(input?.performanceDomReadyWarning, 500, 30000, DEFAULT_SETTINGS.performanceDomReadyWarning),
    performanceLoadWarning: clampNumber(input?.performanceLoadWarning, 500, 60000, DEFAULT_SETTINGS.performanceLoadWarning),
    performanceLoadError: clampNumber(input?.performanceLoadError, 500, 120000, DEFAULT_SETTINGS.performanceLoadError),
    performanceResourceSizeWarning: clampNumber(input?.performanceResourceSizeWarning, 64 * 1024, 20 * 1024 * 1024, DEFAULT_SETTINGS.performanceResourceSizeWarning),
    retainHours: clampNumber(input?.retainHours, 1, 24 * 30, DEFAULT_SETTINGS.retainHours),
    extraRedactionKeys: input?.extraRedactionKeys ?? DEFAULT_SETTINGS.extraRedactionKeys
  };
}

function needsSettingsMigration(input: Partial<DiagnosticSettings> | undefined, settings: DiagnosticSettings): boolean {
  return !!input && input.uiTheme !== undefined && input.uiTheme !== settings.uiTheme;
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
