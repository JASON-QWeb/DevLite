import { buildElementAddress } from "./content/elementAddress";
import { isDevLiteNode, normalizeOverlayZoom, resolveEventElement, shadowRootOf, type InspectableElement } from "./content/domContext";
import { ElementExecutor } from "./content/elementExecutor";
import { RootRegistry } from "./content/rootRegistry";
import { SETTINGS_KEY } from "./shared/defaults";
import { contentText } from "./content/i18n";
import type { ElementCommandRequest, FrameInfo } from "./shared/elementCommands";

(() => {
  const isolated = globalThis as typeof globalThis & { __DEVLITE_FRAME_INSTALLED__?: boolean; __DEVLITE_FRAME_INFO__?: FrameInfo };
  if (isolated.__DEVLITE_FRAME_INSTALLED__) return;
  isolated.__DEVLITE_FRAME_INSTALLED__ = true;
  const isTop = window === window.top;
  let info: FrameInfo | null = null;
  let active = false;
  let epoch = "";
  let locale: "zh" | "en" = "zh";
  let overlay: HTMLDivElement | null = null;
  let highlightRoot: ShadowRoot | null = null;
  let highlighted: InspectableElement | null = null;
  let drawFrame: number | null = null;
  let linkTimer: number | null = null;
  let linkAttempts = 0;
  let listenerController: AbortController | null = null;
  const resizeObserver = new ResizeObserver(() => draw());
  const completedCommands = new Map<string, Record<string, unknown>>();
  const roots = new RootRegistry(document, () => executor.refreshHighlight(), () => draw());
  const send = (message: Record<string, unknown>) => chrome.runtime.sendMessage(message);
  const executor = new ElementExecutor({
    context: () => ({ documentId: info!.documentId, frameId: info!.frameId, url: location.href, framePath: info!.framePath }), roots,
    t: (key) => contentText(locale, key),
    onHighlight: (element) => {
      resizeObserver.disconnect();
      highlighted = element;
      if (element?.isConnected) resizeObserver.observe(element);
      draw();
    },
    onToast: (text) => { void send({ type: "element-toast", text }).catch(() => undefined); },
    onSelected: (snapshot) => {
      if (active) void send({ type: "element-selected", epoch, snapshot }).catch(() => undefined);
      if (snapshot.change.address?.fingerprint.tag === "iframe") void send({ type: "element-frame-status", address: snapshot.change.address }).then((result) => {
        if (!result?.connected) void send({ type: "element-toast", text: contentText(locale, "frameContainerOnly") });
      }).catch(() => undefined);
    },
    onChanged: (snapshot) => { void send({ type: "element-updated", snapshot }).catch(() => undefined); }
  });

  async function hello(): Promise<void> {
    const response = await send({ type: "element-frame-hello" });
    if (!response?.ok) return;
    setContext(response.context);
    setState(response.state);
  }

  function setContext(context: FrameInfo): void {
    info = context;
    isolated.__DEVLITE_FRAME_INFO__ = context;
    if (!isTop && !info.pathReady && linkTimer === null) linkTimer = window.setInterval(() => {
      linkParent();
      if (++linkAttempts >= 20 && linkTimer !== null) { window.clearInterval(linkTimer); linkTimer = null; }
    }, 500);
    if (info.pathReady && linkTimer !== null) { window.clearInterval(linkTimer); linkTimer = null; }
    linkParent();
  }

  function linkParent(force = false): void {
    if (!isTop && info && (!info.pathReady || force)) window.parent.postMessage({ channel: "devlite-frame-link", documentId: info.documentId, nonce: info.nonce }, "*");
  }

  function frameHost(source: MessageEventSource | null, root: ParentNode = document): HTMLIFrameElement | null {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (isDevLiteNode(element)) continue;
      if (element.localName === "iframe" && (element as HTMLIFrameElement).contentWindow === source) return element as HTMLIFrameElement;
      const shadow = shadowRootOf(element);
      if (shadow) { const found = frameHost(source, shadow); if (found) return found; }
    }
    return null;
  }

  function onFrameLink(event: MessageEvent): void {
    if (!info?.pathReady || event.data?.channel !== "devlite-frame-link") return;
    const host = frameHost(event.source);
    if (!host) return;
    void send({ type: "element-frame-link", childDocumentId: event.data.documentId, nonce: event.data.nonce, address: buildElementAddress(host) }).catch(() => undefined);
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "devlite-frame-context") {
      setContext(message.context);
      respond({ ok: true });
      return;
    }
    if (message?.type === "devlite-inspector-state") {
      setState(message);
      if (!isTop) respond({ ok: true });
      return;
    }
    if (message?.type !== "devlite-element-command" || isTop) return;
    const request = message as ElementCommandRequest;
    if (!info || request.documentId !== info.documentId) { respond({ ok: false, status: "stale-handle" }); return; }
    try {
      let result = completedCommands.get(request.requestId);
      const replayed = !!result;
      if (!result) {
        result = executor.execute(request.change, request.command);
        completedCommands.set(request.requestId, result);
        if (completedCommands.size > 64) completedCommands.delete(completedCommands.keys().next().value!);
      }
      respond({ ...result, replayed });
    } catch (error) {
      respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  function setState(state: { active: boolean; epoch: string; ownerDocumentId?: string }): void {
    // document.open() (used by iframe renderers) removes DOM listeners but keeps the extension connection.
    installListeners();
    active = state.active;
    epoch = state.epoch;
    if (isTop) return;
    if (active) {
      linkParent(true);
      linkAttempts = 0;
      if (info && !info.pathReady) setContext(info);
      roots.start();
      roots.setActive(true);
      executor.clearSelection();
    } else {
      roots.setActive(false);
      if (state.ownerDocumentId !== info?.documentId) {
        executor.clearSelection();
        if (!executor.hasChanges()) roots.stop();
      }
    }
  }

  function installListeners(): void {
    listenerController?.abort();
    listenerController = new AbortController();
    const signal = listenerController.signal;
    const capture = { capture: true, signal };
    window.addEventListener("message", onFrameLink, { signal });
    window.addEventListener("pagehide", onPageHide, { signal });
    window.addEventListener("pageshow", (event) => { if (event.persisted) void hello().catch(() => undefined); }, { signal });
    if (isTop) return;
    document.addEventListener("mousemove", (event) => {
      if (!active) return;
      const element = resolveEventElement(event);
      if (element) { highlighted = element; roots.register(element.getRootNode() as Document | ShadowRoot); draw(); }
    }, capture);
    document.addEventListener("click", (event) => {
      if (event.composedPath().some(isDevLiteNode)) return;
      const element = resolveEventElement(event);
      if (!active) {
        if (event.detail > 1 && executor.isSelectedTarget(element)) { event.preventDefault(); event.stopImmediatePropagation(); }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (element && info) executor.select(element);
    }, capture);
    document.addEventListener("dblclick", (event) => {
      if (event.composedPath().some(isDevLiteNode) || !executor.isSelectedTarget(resolveEventElement(event))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      executor.editSelectedText();
    }, capture);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "auxclick", "dragstart", "contextmenu"]) {
      window.addEventListener(type, (event) => {
        if (!active || event.composedPath().some(isDevLiteNode)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, capture);
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && active) {
        event.preventDefault();
        void send({ type: "element-inspector-set", active: false });
      }
    }, capture);
    window.addEventListener("resize", () => draw(), { signal });
    window.visualViewport?.addEventListener("resize", () => draw(), { signal });
    window.visualViewport?.addEventListener("scroll", () => draw(), { signal });
    document.addEventListener("fullscreenchange", () => { overlay?.hidePopover?.(); draw(); }, { signal });
    document.addEventListener("toggle", (event) => { if (!isDevLiteNode(event.target)) { overlay?.hidePopover?.(); draw(); } }, capture);
  }

  function draw(): void {
    if (drawFrame !== null || isTop) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = null;
      if (!highlighted?.isConnected) { overlay?.hidePopover?.(); if (overlay) overlay.style.display = "none"; return; }
      if (overlay && !overlay.isConnected) { overlay = null; highlightRoot = null; }
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.setAttribute("data-devlite-owned", "");
        overlay.id = "devlite-frame-highlight";
        overlay.popover = "manual";
        overlay.style.cssText = "all:initial;position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;border:0;margin:0;padding:0;background:transparent;pointer-events:none;z-index:2147483647;";
        highlightRoot = overlay.attachShadow({ mode: "open" });
        document.documentElement.appendChild(overlay);
      }
      overlay.style.display = "block";
      normalizeOverlayZoom(overlay);
      if (!overlay.matches(":popover-open")) overlay.showPopover?.();
      highlightRoot!.replaceChildren(...Array.from(highlighted.getClientRects()).slice(0, 80).map((rect) => {
        const outline = document.createElement("div");
        outline.style.cssText = `position:fixed;box-sizing:border-box;pointer-events:none;border:2px solid #6366f1;background:rgba(99,102,241,.08);left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;`;
        return outline;
      }));
    });
  }

  function onPageHide(): void {
    roots.stop();
    executor.clearSelection();
    resizeObserver.disconnect();
    if (linkTimer !== null) window.clearInterval(linkTimer);
    linkTimer = null;
  }
  installListeners();
  void chrome.storage.local.get(SETTINGS_KEY).then((data) => { locale = data[SETTINGS_KEY]?.locale === "en" ? "en" : "zh"; });
  void hello().catch(() => undefined);
})();
