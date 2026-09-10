import type { ElementCommand, ElementSnapshot, FrameInfo } from "../shared/elementCommands";
import type { ElementDocumentContext, StyleChange } from "../shared/types";
import { sessionStore } from "./sessionStore";

type InspectionState = { active: boolean; epoch: string; ownerDocumentId?: string };
const frames = new Map<number, Map<string, FrameInfo>>();
const stateUpdates = new Map<number, Promise<InspectionState>>();
const stateKey = (tabId: number) => `devlite:inspection:${tabId}`;

async function inspectionState(tabId: number): Promise<InspectionState> {
  const key = stateKey(tabId);
  return (await chrome.storage.session.get(key))[key] ?? { active: false, epoch: "" };
}

export async function setInspectionState(tabId: number, active: boolean, epoch?: string, ownerDocumentId?: string): Promise<InspectionState> {
  const pending = (stateUpdates.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    if (active) await readFrames(tabId);
    const current = await inspectionState(tabId);
    if (ownerDocumentId && (!current.active || current.epoch !== epoch)) return current;
    const state = { active, epoch: epoch ?? crypto.randomUUID(), ownerDocumentId };
    await chrome.storage.session.set({ [stateKey(tabId)]: state });
    await chrome.tabs.sendMessage(tabId, { type: "devlite-inspector-state", ...state }).catch(() => undefined);
    return state;
  });
  stateUpdates.set(tabId, pending);
  try { return await pending; }
  finally { if (stateUpdates.get(tabId) === pending) stateUpdates.delete(tabId); }
}

export function clearFrameRegistry(tabId: number): void {
  frames.delete(tabId);
  void chrome.storage.session.remove(stateKey(tabId));
}

async function readFrames(tabId: number): Promise<Map<string, FrameInfo>> {
  const previousIds = new Set(frames.get(tabId)?.keys());
  // Native injection results provide authoritative document identities, including after worker restart.
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => { const info = (globalThis as typeof globalThis & { __DEVLITE_FRAME_INFO__?: FrameInfo }).__DEVLITE_FRAME_INFO__; return info ? { ...info, url: location.href } : null; }
  }).catch(() => []);
  const online = new Map<string, FrameInfo>();
  for (const result of results) {
    if (result.result && result.documentId) online.set(result.documentId, { ...result.result, documentId: result.documentId, frameId: result.frameId });
  }
  const registered = frames.get(tabId) ?? new Map<string, FrameInfo>();
  for (const id of previousIds) if (!online.has(id)) registered.delete(id);
  for (const [id, info] of online) registered.set(id, info);
  frames.set(tabId, registered);
  return online;
}

function publicContext(context: ElementDocumentContext): ElementDocumentContext {
  const { documentId, frameId, url, framePath } = context;
  return { documentId, frameId, url, framePath };
}

async function persistSnapshot(tabId: number, snapshot: ElementSnapshot, context: ElementDocumentContext, previousDocumentId?: string): Promise<boolean> {
  const change = { ...snapshot.change, context: publicContext(context) };
  let accepted = false;
  await sessionStore.update(tabId, (session) => {
    if (!session) return undefined;
    const index = session.styleChanges.findIndex((entry) => entry.id === change.id);
    const existing = session.styleChanges[index];
    if (existing && ((existing.context?.documentId !== context.documentId && existing.context?.documentId !== previousDocumentId) || existing.updatedAt > change.updatedAt)) return session;
    if (index >= 0) session.styleChanges[index] = change;
    else session.styleChanges.push(change);
    accepted = true;
    session.updatedAt = Date.now();
    return session;
  });
  return accepted;
}

export async function handleFrameMessage(message: any, sender: chrome.runtime.MessageSender): Promise<any | undefined> {
  if (!String(message?.type).startsWith("element-")) return undefined;
  const tabId = sender.tab?.id;
  const documentId = sender.documentId;
  if (typeof tabId !== "number" || !documentId) return { ok: false, error: "Document unavailable" };
  let tabFrames = frames.get(tabId);
  if (!tabFrames) {
    tabFrames = new Map();
    frames.set(tabId, tabFrames);
    await readFrames(tabId);
  }
  const senderInfo = tabFrames.get(documentId);
  if (senderInfo && sender.url) senderInfo.url = sender.url;

  if (message.type === "element-frame-hello") {
    for (const [id, info] of tabFrames) if (info.frameId === sender.frameId && id !== documentId) tabFrames.delete(id);
    const existing = tabFrames.get(documentId);
    const context: FrameInfo = {
      documentId, frameId: sender.frameId ?? 0, url: sender.url ?? "", nonce: existing?.nonce ?? crypto.randomUUID(),
      framePath: existing?.framePath ?? [], pathReady: sender.frameId === 0 || existing?.pathReady === true
    };
    tabFrames.set(documentId, context);
    return { ok: true, context, state: await inspectionState(tabId) };
  }

  if (message.type === "element-frame-link") {
    const parent = tabFrames.get(documentId);
    const child = tabFrames.get(message.childDocumentId);
    if (!parent?.pathReady || !child || child.nonce !== message.nonce || child.documentId === documentId || !message.address) return { ok: false };
    child.framePath = [...parent.framePath, message.address];
    child.pathReady = true;
    await chrome.tabs.sendMessage(tabId, { type: "devlite-frame-context", context: child }, { documentId: child.documentId }).catch(() => undefined);
    return { ok: true };
  }

  if (message.type === "element-frame-status") {
    const parent = tabFrames.get(documentId);
    const expectedPath = [...(parent?.framePath ?? []), message.address];
    const online = await readFrames(tabId);
    const connected = [...online.values()].some((info) => info.pathReady && JSON.stringify(info.framePath) === JSON.stringify(expectedPath));
    return { ok: true, connected };
  }

  if (message.type === "element-inspector-set") {
    return { ok: true, state: await setInspectionState(tabId, !!message.active) };
  }

  if (message.type === "element-selection-done" || message.type === "element-selected") {
    const state = await inspectionState(tabId);
    if (!state.active || (message.epoch && message.epoch !== state.epoch)) return { ok: false, status: "stale-selection" };
    const selected = await setInspectionState(tabId, false, state.epoch, documentId);
    if (selected.active || selected.epoch !== state.epoch || selected.ownerDocumentId !== documentId) return { ok: false, status: "stale-selection" };
    if (message.type === "element-selected") {
      const context = tabFrames.get(documentId);
      if (!context || !message.snapshot?.change) return { ok: false };
      message.snapshot.change.context = publicContext(context);
      await chrome.tabs.sendMessage(tabId, { type: "devlite-remote-selected", epoch: state.epoch, snapshot: message.snapshot }, { frameId: 0 });
    }
    return { ok: true };
  }

  if (message.type === "element-toast") {
    await chrome.tabs.sendMessage(tabId, { type: "devlite-remote-toast", text: String(message.text) }, { frameId: 0 }).catch(() => undefined);
    return { ok: true };
  }

  if (message.type === "element-updated") {
    const context = tabFrames.get(documentId);
    if (!context || !message.snapshot?.change) return { ok: false };
    if (!await persistSnapshot(tabId, message.snapshot, context)) return { ok: false, status: "stale-handle" };
    await chrome.tabs.sendMessage(tabId, { type: "devlite-remote-updated", snapshot: { ...message.snapshot, change: { ...message.snapshot.change, context: publicContext(context) } } }, { frameId: 0 }).catch(() => undefined);
    return { ok: true };
  }

  if (message.type === "element-command") {
    const change = message.change as StyleChange;
    const command = message.command as ElementCommand;
    if (!change?.context || !command || (sender.frameId !== 0 && change.context.documentId !== documentId)) return { ok: false, error: "Invalid element command" };
    let targetId = change.context.documentId;
    const requestId = String(message.requestId ?? crypto.randomUUID());
    const send = (id: string) => chrome.tabs.sendMessage(tabId, { type: "devlite-element-command", requestId, documentId: id, change, command }, { documentId: id });
    let response;
    try { response = await send(targetId); }
    catch {
      if (!["verify", "undo", "forget"].includes(command.action) || !change.context.framePath.length) {
        return { ok: false, status: "document-unavailable" };
      }
      const online = await readFrames(tabId);
      const matches = [...online.values()].filter((info) => info.pathReady && info.url === change.context!.url && JSON.stringify(info.framePath) === JSON.stringify(change.context!.framePath));
      if (matches.length !== 1) return { ok: false, status: matches.length > 1 ? "ambiguous" : "document-unavailable" };
      targetId = matches[0].documentId;
      response = await send(targetId).catch(() => ({ ok: false, status: "document-unavailable" }));
    }
    if (!response?.ok) return response ?? { ok: false, status: "document-unavailable" };
    if (response.snapshot && command.action !== "parent" && !response.replayed) {
      const context = (frames.get(tabId)?.get(targetId) ?? change.context) as FrameInfo;
      response.snapshot.change.context = publicContext(context);
      await persistSnapshot(tabId, response.snapshot, context, change.context.documentId);
    }
    if (response.removed && !response.replayed) {
      await sessionStore.update(tabId, (session) => {
        if (!session) return undefined;
        session.styleChanges = session.styleChanges.filter((entry) => entry.id !== response.removed);
        return session;
      });
    }
    return { ...response, requestId };
  }
  return { ok: false, error: "Unknown element message" };
}
