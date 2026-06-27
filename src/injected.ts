import Cropper from "cropperjs";
import type { CropperImage, CropperSelection } from "cropperjs";
import { CONTROL_CHANNEL, PAGE_CHANNEL } from "./shared/channels";
import { classifyDevelopmentTransport } from "./shared/developmentTraffic";

type ImageCropperPayload = {
  src: string;
  label: string;
  name: string;
  type: string;
  size: number;
};

type ImageCropperTexts = Record<
  "cropImage" | "cancel" | "matchElementRatio" | "freeRatio" | "zoomOut" | "zoomIn" | "resetCrop" | "applyCrop",
  string
>;

type ImageCropperSession = {
  id: string;
  root: HTMLDivElement;
  cropper: Cropper;
  payload: ImageCropperPayload;
  source: { width: number; height: number };
  targetAspectRatio: number | null;
  texts: ImageCropperTexts;
};

(() => {
  const win = window as any;
  if (win.__DEVLITE_PAGE_INSTALLED__) {
    return;
  }
  win.__DEVLITE_PAGE_INSTALLED__ = true;
  const pageMessageTargetOrigin = window.location.origin === "null" ? "*" : window.location.origin;

  let active = false;
  let bufferEarlyEvents = true;
  const pendingEvents: any[] = [];
  const MAX_PENDING_EVENTS = 200;
  const MAX_CROP_OUTPUT_EDGE = 1600;
  const CROP_OUTPUT_TYPE = "image/png";
  let controlMessageToken: string | null = null;
  let activeImageCropper: ImageCropperSession | null = null;
  let settings = {
    collectResponseBody: false,
    maxResponseLength: 2048,
    slowRequestThreshold: 2000
  };

  const originalFetch = window.fetch.bind(window);
  const originalConsoleError = console.error.bind(console);
  const originalConsoleLog = console.log.bind(console);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const xhrMetaKey = Symbol("__devlite_meta__");
  const OriginalWebSocket = window.WebSocket;
  const OriginalEventSource = window.EventSource;

  window.addEventListener("message", (event) => {
    if (!isTrustedControlMessage(event)) return;
    const data = event.data;
    if (!data || data.channel !== CONTROL_CHANNEL) return;
    if (typeof data.token !== "string") return;
    if (controlMessageToken !== null && data.token !== controlMessageToken && data.type !== "start") return;
    if (controlMessageToken === null || data.type === "start") {
      controlMessageToken = data.token;
    }
    if (data.type === "image-cropper-open") {
      void openImageCropper(data).catch((error) => postImageCropperError(data.cropperId, error));
      return;
    }
    if (data.type === "image-cropper-close") {
      closeImageCropper(data.cropperId, false);
      return;
    }
    if (data.type === "start") {
      active = true;
      bufferEarlyEvents = false;
      settings = { ...settings, ...(data.settings ?? {}) };
      flushPendingEvents();
      emit({
        type: "performance",
        severity: "info",
        message: "DevLite 已开始诊断当前页面",
        metadata: getPerformanceSnapshot()
      });
    }
    if (data.type === "settings") {
      settings = { ...settings, ...(data.settings ?? {}) };
    }
    if (data.type === "stop") {
      active = false;
      bufferEarlyEvents = false;
      pendingEvents.splice(0, pendingEvents.length);
    }
  });

  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) return;
    emit({
      type: "js-error",
      severity: "error",
      message: event.message || "Script error",
      source: event.filename,
      stack: event.error?.stack,
      metadata: {
        line: event.lineno,
        column: event.colno
      }
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    emit({
      type: "unhandled-rejection",
      severity: "error",
      message: stringifyReason(event.reason),
      stack: event.reason?.stack
    });
  });

  console.error = (...args: unknown[]) => {
    emit({
      type: "console-error",
      severity: "error",
      message: args.map(serialize).join(" "),
      stack: new Error("console.error").stack
    });
    originalConsoleError(...args);
  };

  console.log = (...args: unknown[]) => {
    if (active) {
      emit({
        type: "console-log",
        severity: "info",
        message: args.map(serialize).join(" "),
        metadata: {
          consoleMethod: "log"
        }
      });
    }
    originalConsoleLog(...args);
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = performance.now();
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const method = init?.method ?? request?.method ?? "GET";
    const requestBody = await summarizeFetchRequestBody(request, init);
    const requestHeaders = collectFetchRequestHeaders(request, init);

    try {
      const response = await originalFetch(input, init);
      const duration = Math.round(performance.now() - startedAt);
      const baseEvent = {
        type: "network",
        severity: response.status >= 400 ? "error" : duration >= settings.slowRequestThreshold ? "warning" : "info",
        message: `${method} ${url} -> ${response.status}`,
        url,
        method,
        status: response.status,
        duration,
        requestBody,
        metadata: {
          source: "fetch",
          ok: response.ok,
          redirected: response.redirected,
          contentType: response.headers.get("content-type") ?? "",
          requestHeaders,
          responseHeaders: headersToObject(response.headers)
        }
      };

      if (active && settings.collectResponseBody) {
        response
          .clone()
          .text()
          .then((body) => {
            emit({
              ...baseEvent,
              responseBody: truncate(body, settings.maxResponseLength)
            });
          })
          .catch(() => emit(baseEvent));
      } else {
        emit(baseEvent);
      }

      return response;
    } catch (error) {
      emit({
        type: "network",
        severity: "error",
        message: `${method} ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
        url,
        method,
        duration: Math.round(performance.now() - startedAt),
        requestBody,
        metadata: {
          source: "fetch",
          requestHeaders,
          error: serialize(error)
        }
      });
      throw error;
    }
  };

  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    (this as any)[xhrMetaKey] = {
      method,
      url: String(url),
      headers: {},
      startedAt: 0
    };
    return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name: string, value: string) {
    const meta = (this as any)[xhrMetaKey];
    if (meta) {
      meta.headers[name] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this;
    const meta = (xhr as any)[xhrMetaKey] ?? {};
    meta.startedAt = performance.now();
    meta.requestBody = summarizeBody(body);
    (xhr as any)[xhrMetaKey] = meta;

    let finalized = false;
    const finalize = (kind: "loadend" | "error" | "timeout" | "abort") => {
      if (finalized) return;
      finalized = true;
      const duration = Math.round(performance.now() - meta.startedAt);
      const status = xhr.status || undefined;
      const responseText = settings.collectResponseBody ? summarizeXhrResponse(xhr) : undefined;
      emit({
        type: "network",
        severity: kind !== "loadend" || (status && status >= 400) ? "error" : duration >= settings.slowRequestThreshold ? "warning" : "info",
        message: `${meta.method ?? "GET"} ${meta.url ?? ""} -> ${status ?? kind}`,
        url: meta.url,
        method: meta.method,
        status,
        duration,
        requestBody: meta.requestBody,
        responseBody: responseText,
        metadata: {
          source: "xhr",
          event: kind,
          responseType: xhr.responseType,
          requestHeaders: meta.headers,
          responseHeaders: parseHeaderText(xhr.getAllResponseHeaders())
        }
      });
    };

    xhr.addEventListener("loadend", () => finalize("loadend"), { once: true });
    xhr.addEventListener("error", () => finalize("error"), { once: true });
    xhr.addEventListener("timeout", () => finalize("timeout"), { once: true });
    xhr.addEventListener("abort", () => finalize("abort"), { once: true });

    return originalSend.call(xhr, body ?? null);
  };

  window.WebSocket = function patchedWebSocket(url: string | URL, protocols?: string | string[]) {
    const startedAt = performance.now();
    const socket = protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
    const targetUrl = String(url);
    const protocolList = normalizeWebSocketProtocols(protocols);
    const transportMetadata: Record<string, unknown> = {
      protocols: protocolList,
      ...classifyDevelopmentTransport(targetUrl, protocolList, "websocket")
    };
    socket.addEventListener("open", () => {
      emitTransportEvent("websocket", "open", targetUrl, "WS", Math.round(performance.now() - startedAt), "info", transportMetadata);
    });
    socket.addEventListener("error", () => {
      emitTransportEvent("websocket", "error", targetUrl, "WS", Math.round(performance.now() - startedAt), "error", transportMetadata);
    });
    socket.addEventListener("close", (event) => {
      const severity = event.wasClean ? "info" : "warning";
      emitTransportEvent("websocket", `close:${event.code}`, targetUrl, "WS", Math.round(performance.now() - startedAt), severity, {
        ...transportMetadata,
        reason: event.reason,
        wasClean: event.wasClean
      });
    });
    socket.addEventListener("message", (event) => {
      if (!settings.collectResponseBody) return;
      if (transportMetadata.devTransport) return;
      emitTransportEvent("websocket", "message", targetUrl, "WS", undefined, "info", transportMetadata, summarizeBody(event.data));
    });
    return socket;
  } as unknown as typeof WebSocket;
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  Object.setPrototypeOf(window.WebSocket, OriginalWebSocket);

  if (OriginalEventSource) {
    window.EventSource = function patchedEventSource(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const startedAt = performance.now();
      const source = new OriginalEventSource(url, eventSourceInitDict);
      const targetUrl = String(url);
      const transportMetadata = classifyDevelopmentTransport(targetUrl, [], "eventsource");
      source.addEventListener("open", () => {
        emitTransportEvent("eventsource", "open", targetUrl, "SSE", Math.round(performance.now() - startedAt), "info", transportMetadata);
      });
      source.addEventListener("error", () => {
        emitTransportEvent("eventsource", "error", targetUrl, "SSE", Math.round(performance.now() - startedAt), "warning", {
          ...transportMetadata,
          readyState: source.readyState
        });
      });
      source.addEventListener("message", (event) => {
        if (!settings.collectResponseBody) return;
        if (transportMetadata.devTransport) return;
        emitTransportEvent("eventsource", "message", targetUrl, "SSE", undefined, "info", {
          ...transportMetadata,
          lastEventId: event.lastEventId
        }, summarizeBody(event.data));
      });
      return source;
    } as unknown as typeof EventSource;
    window.EventSource.prototype = OriginalEventSource.prototype;
    Object.setPrototypeOf(window.EventSource, OriginalEventSource);
  }

  async function openImageCropper(data: any): Promise<void> {
    const payload = normalizeImageCropperPayload(data.payload);
    const cropperId = typeof data.cropperId === "string" ? data.cropperId : "";
    if (!cropperId || !payload) throw new Error("Invalid image cropper request");
    closeImageCropper(undefined, false);

    const host = document.querySelector("#devlite-overlay-root");
    const shadow = host?.shadowRoot;
    if (!shadow) throw new Error("DevLite overlay root not found");

    const texts = normalizeImageCropperTexts(data.texts);
    const targetAspectRatio = typeof data.targetAspectRatio === "number" && Number.isFinite(data.targetAspectRatio) ? data.targetAspectRatio : null;
    const source = await loadImageSize(payload.src);
    const root = document.createElement("div");
    root.className = "image-cropper-modal";
    root.innerHTML = renderImageCropperMarkup(texts, payload, targetAspectRatio);
    shadow.appendChild(root);

    try {
      const container = root.querySelector<HTMLElement>("[data-cropper-container]");
      if (!container) throw new Error("Cropper container not found");
      const image = new Image();
      image.src = payload.src;
      image.alt = payload.name;
      const cropper = new Cropper(image, {
        container,
        template: imageCropperTemplate(targetAspectRatio)
      });
      const session = { id: cropperId, root, cropper, payload, source, targetAspectRatio, texts };
      activeImageCropper = session;
      bindImageCropperControls(session);
      await cropper.getCropperImage()?.$ready();
      cropper.getCropperImage()?.$center("contain");
      await nextAnimationFrame();
      await nextAnimationFrame();
      if (activeImageCropper === session) {
        ensureImageCropperSelectionLayout(session, true);
      }
    } catch (error) {
      root.remove();
      throw error;
    }
  }

  function bindImageCropperControls(session: ImageCropperSession): void {
    session.root.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-cropper-action]") : null;
      if (!button) return;
      event.preventDefault();
      void handleImageCropperAction(session, button.dataset.cropperAction ?? "").catch((error) => postImageCropperError(session.id, error));
    });
  }

  async function handleImageCropperAction(session: ImageCropperSession, action: string): Promise<void> {
    if (activeImageCropper !== session) return;
    const selection = session.cropper.getCropperSelection();
    const image = session.cropper.getCropperImage();
    if (action === "cancel") {
      postImageCropperCancel(session.id);
      closeImageCropper(session.id, false);
      return;
    }
    if (action === "zoom-in") {
      image?.$zoom(0.1);
      return;
    }
    if (action === "zoom-out") {
      image?.$zoom(-0.1);
      return;
    }
    if (action === "reset") {
      image?.$resetTransform();
      image?.$center("contain");
      selection?.$reset();
      ensureImageCropperSelectionLayout(session, true);
      return;
    }
    if (action === "free-ratio") {
      setImageCropperAspectRatio(session, selection, null);
      return;
    }
    if (action === "target-ratio") {
      setImageCropperAspectRatio(session, selection, session.targetAspectRatio);
      return;
    }
    if (action === "apply") {
      await applyImageCrop(session, selection, image);
    }
  }

  function setImageCropperAspectRatio(session: ImageCropperSession, selection: CropperSelection | null, aspectRatio: number | null): void {
    if (!selection) return;
    selection.aspectRatio = aspectRatio && Number.isFinite(aspectRatio) ? aspectRatio : Number.NaN;
    selection.$render();
    ensureImageCropperSelectionLayout(session);
    session.root
      .querySelectorAll<HTMLButtonElement>("[data-cropper-action='target-ratio'], [data-cropper-action='free-ratio']")
      .forEach((button) => {
        const active =
          (button.dataset.cropperAction === "target-ratio" && !!aspectRatio) ||
          (button.dataset.cropperAction === "free-ratio" && !aspectRatio);
        button.classList.toggle("active", active);
      });
  }

  function ensureImageCropperSelectionLayout(session: ImageCropperSession, force = false): void {
    const selection = session.cropper.getCropperSelection();
    const canvas = session.cropper.getCropperCanvas();
    const rect = canvas?.getBoundingClientRect();
    if (!selection || !rect || rect.width <= 1 || rect.height <= 1 || (!force && selection.width > 0 && selection.height > 0)) {
      return;
    }
    const ratio = Number.isFinite(selection.aspectRatio) ? selection.aspectRatio : session.targetAspectRatio;
    let width = rect.width * 0.86;
    let height = rect.height * 0.86;
    if (ratio && Number.isFinite(ratio)) {
      if (width / height > ratio) {
        width = height * ratio;
      } else {
        height = width / ratio;
      }
    }
    selection.$change((rect.width - width) / 2, (rect.height - height) / 2, width, height, ratio ?? undefined, true);
  }

  async function applyImageCrop(session: ImageCropperSession, selection: CropperSelection | null, image: CropperImage | null): Promise<void> {
    if (!selection) {
      postImageCropperError(session.id, new Error("Cropper selection not found"));
      return;
    }
    ensureImageCropperSelectionLayout(session);
    const outputSize = cropOutputSize(selection);
    const canvas = await selection.$toCanvas(outputSize);
    const crop = cropSelectionMetrics(selection);
    const result = {
      src: canvas.toDataURL(CROP_OUTPUT_TYPE),
      label: `${session.texts.cropImage}: ${session.payload.label} -> ${canvas.width}x${canvas.height}`,
      metadata: {
        mode: "crop",
        source: {
          name: session.payload.name,
          type: session.payload.type,
          size: session.payload.size,
          width: session.source.width,
          height: session.source.height
        },
        crop: {
          x: round(crop.x),
          y: round(crop.y),
          width: round(crop.width),
          height: round(crop.height),
          aspectRatio: selection.aspectRatio > 0 && Number.isFinite(selection.aspectRatio) ? round(selection.aspectRatio) : null
        },
        output: {
          width: canvas.width,
          height: canvas.height,
          type: CROP_OUTPUT_TYPE
        }
      }
    };
    image?.$resetTransform();
    postImageCropperResult(session.id, result);
    closeImageCropper(session.id, false);
  }

  function closeImageCropper(cropperId?: unknown, notifyCancel = false): void {
    const session = activeImageCropper;
    if (!session || (typeof cropperId === "string" && cropperId !== session.id)) return;
    activeImageCropper = null;
    session.cropper.destroy();
    session.root.remove();
    if (notifyCancel) postImageCropperCancel(session.id);
  }

  function postImageCropperResult(cropperId: string, result: unknown): void {
    window.postMessage({ channel: PAGE_CHANNEL, token: controlMessageToken, type: "image-cropper-result", cropperId, result }, pageMessageTargetOrigin);
  }

  function postImageCropperCancel(cropperId: string): void {
    window.postMessage({ channel: PAGE_CHANNEL, token: controlMessageToken, type: "image-cropper-cancel", cropperId }, pageMessageTargetOrigin);
  }

  function postImageCropperError(cropperId: unknown, error: unknown): void {
    if (typeof cropperId !== "string") return;
    closeImageCropper(cropperId, false);
    window.postMessage(
      {
        channel: PAGE_CHANNEL,
        token: controlMessageToken,
        type: "image-cropper-error",
        cropperId,
        error: error instanceof Error ? error.message : String(error)
      },
      pageMessageTargetOrigin
    );
  }

  function renderImageCropperMarkup(texts: ImageCropperTexts, payload: ImageCropperPayload, targetAspectRatio: number | null): string {
    return `
      <div class="image-cropper-shell" role="dialog" aria-label="${escapeHtml(texts.cropImage)}">
        <div class="image-cropper-head">
          <div>
            <strong>${escapeHtml(texts.cropImage)}</strong>
            <span>${escapeHtml(payload.label)}</span>
          </div>
          <button type="button" data-cropper-action="cancel">${escapeHtml(texts.cancel)}</button>
        </div>
        <div class="image-cropper-stage" data-cropper-container></div>
        <div class="image-cropper-actions">
          <div class="toolbar-group">
            <button type="button" class="${targetAspectRatio ? "active" : ""}" data-cropper-action="target-ratio" ${targetAspectRatio ? "" : "disabled"}>${escapeHtml(texts.matchElementRatio)}</button>
            <button type="button" class="${targetAspectRatio ? "" : "active"}" data-cropper-action="free-ratio">${escapeHtml(texts.freeRatio)}</button>
          </div>
          <div class="toolbar-group toolbar-group-right">
            <button type="button" data-cropper-action="zoom-out">${escapeHtml(texts.zoomOut)}</button>
            <button type="button" data-cropper-action="zoom-in">${escapeHtml(texts.zoomIn)}</button>
            <button type="button" data-cropper-action="reset">${escapeHtml(texts.resetCrop)}</button>
            <button type="button" class="primary" data-cropper-action="apply">${escapeHtml(texts.applyCrop)}</button>
          </div>
        </div>
      </div>
    `;
  }

  function imageCropperTemplate(aspectRatio: number | null): string {
    const ratio = aspectRatio && Number.isFinite(aspectRatio) ? ` aspect-ratio="${aspectRatio}" initial-aspect-ratio="${aspectRatio}"` : "";
    return `
      <cropper-canvas background scale-step="0.1">
        <cropper-image translatable scalable></cropper-image>
        <cropper-shade hidden></cropper-shade>
        <cropper-handle action="move" plain></cropper-handle>
        <cropper-selection initial-coverage="0.86" movable resizable outlined precise keyboard${ratio}>
          <cropper-grid role="grid" bordered covered></cropper-grid>
          <cropper-crosshair centered></cropper-crosshair>
          <cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>
          <cropper-handle action="n-resize"></cropper-handle>
          <cropper-handle action="e-resize"></cropper-handle>
          <cropper-handle action="s-resize"></cropper-handle>
          <cropper-handle action="w-resize"></cropper-handle>
          <cropper-handle action="ne-resize"></cropper-handle>
          <cropper-handle action="nw-resize"></cropper-handle>
          <cropper-handle action="se-resize"></cropper-handle>
          <cropper-handle action="sw-resize"></cropper-handle>
        </cropper-selection>
      </cropper-canvas>
    `;
  }

  function normalizeImageCropperPayload(value: unknown): ImageCropperPayload | null {
    if (!value || typeof value !== "object") return null;
    const payload = value as Partial<ImageCropperPayload>;
    if (typeof payload.src !== "string" || typeof payload.name !== "string") return null;
    return {
      src: payload.src,
      label: typeof payload.label === "string" ? payload.label : payload.name,
      name: payload.name,
      type: typeof payload.type === "string" ? payload.type : "image/png",
      size: typeof payload.size === "number" ? payload.size : 0
    };
  }

  function normalizeImageCropperTexts(value: unknown): ImageCropperTexts {
    const texts = (value && typeof value === "object" ? value : {}) as Partial<ImageCropperTexts>;
    return {
      cropImage: texts.cropImage || "Crop image",
      cancel: texts.cancel || "Cancel",
      matchElementRatio: texts.matchElementRatio || "Match element ratio",
      freeRatio: texts.freeRatio || "Free ratio",
      zoomOut: texts.zoomOut || "Zoom out",
      zoomIn: texts.zoomIn || "Zoom in",
      resetCrop: texts.resetCrop || "Reset",
      applyCrop: texts.applyCrop || "Apply crop"
    };
  }

  function cropOutputSize(selection: CropperSelection): { width: number; height: number } {
    const crop = cropSelectionMetrics(selection);
    const width = Math.max(1, crop.width || 1);
    const height = Math.max(1, crop.height || 1);
    const scale = Math.min(1, MAX_CROP_OUTPUT_EDGE / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function cropSelectionMetrics(selection: CropperSelection): { x: number; y: number; width: number; height: number } {
    const rect = selection.getBoundingClientRect();
    return {
      x: selection.x || 0,
      y: selection.y || 0,
      width: selection.width || rect.width || 1,
      height: selection.height || rect.height || 1
    };
  }

  function loadImageSize(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = src;
    });
  }

  function nextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  }

  function round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  function emit(event: any): void {
    const diagnosticEvent = {
      id: randomId(),
      timestamp: Date.now(),
      ...event
    };
    if (!active) {
      if (!bufferEarlyEvents) return;
      pendingEvents.push(diagnosticEvent);
      if (pendingEvents.length > MAX_PENDING_EVENTS) {
        pendingEvents.splice(0, pendingEvents.length - MAX_PENDING_EVENTS);
      }
      return;
    }
    postEvent(diagnosticEvent);
  }

  function flushPendingEvents(): void {
    const events = pendingEvents.splice(0, pendingEvents.length);
    for (const event of events) {
      postEvent(event);
    }
  }

  function postEvent(event: any): void {
    window.postMessage(
      {
        channel: PAGE_CHANNEL,
        token: controlMessageToken,
        event
      },
      pageMessageTargetOrigin
    );
  }

  function isTrustedControlMessage(event: MessageEvent): boolean {
    return event.source === window && (pageMessageTargetOrigin === "*" || event.origin === window.location.origin);
  }

  function getPerformanceSnapshot(): Record<string, unknown> {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return {};
    return {
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      transferSize: nav.transferSize,
      encodedBodySize: nav.encodedBodySize
    };
  }

  function summarizeBody(body: unknown): string | undefined {
    if (!body) return undefined;
    if (typeof body === "string") return truncate(body, settings.maxResponseLength);
    if (body instanceof URLSearchParams) return truncate(body.toString(), settings.maxResponseLength);
    if (body instanceof FormData) {
      return `[FormData keys: ${Array.from(body.keys()).join(", ")}]`;
    }
    if (body instanceof Blob) {
      return `[Blob ${body.type || "unknown"} ${body.size} bytes]`;
    }
    if (body instanceof ArrayBuffer) {
      return `[ArrayBuffer ${body.byteLength} bytes]`;
    }
    return `[${Object.prototype.toString.call(body)}]`;
  }

  async function summarizeFetchRequestBody(request: Request | null, init?: RequestInit): Promise<string | undefined> {
    const initBody = summarizeBody(init?.body);
    if (initBody || !request) return initBody;
    if (request.method === "GET" || request.method === "HEAD") return undefined;
    try {
      const body = await request.clone().text();
      return body ? truncate(body, settings.maxResponseLength) : undefined;
    } catch {
      return undefined;
    }
  }

  function summarizeXhrResponse(xhr: XMLHttpRequest): string | undefined {
    try {
      if (xhr.responseType && xhr.responseType !== "text") {
        const response = xhr.response;
        if (typeof response === "string") return truncate(response, settings.maxResponseLength);
        if (response instanceof Blob) return `[Blob ${response.type || "unknown"} ${response.size} bytes]`;
        if (response instanceof ArrayBuffer) return `[ArrayBuffer ${response.byteLength} bytes]`;
        if (response !== undefined && response !== null) return truncate(JSON.stringify(response), settings.maxResponseLength);
        return undefined;
      }
      return typeof xhr.responseText === "string" ? truncate(xhr.responseText, settings.maxResponseLength) : undefined;
    } catch {
      return undefined;
    }
  }

  function emitTransportEvent(
    source: "websocket" | "eventsource",
    eventName: string,
    url: string,
    method: "WS" | "SSE",
    duration: number | undefined,
    severity: "info" | "warning" | "error",
    metadata: Record<string, unknown> = {},
    responseBody?: string
  ): void {
    emit({
      type: "network",
      severity,
      message: `${method} ${url} -> ${eventName}`,
      url,
      method,
      duration,
      responseBody,
      metadata: {
        source,
        event: eventName,
        ...metadata
      }
    });
  }

  function normalizeWebSocketProtocols(protocols?: string | string[]): string[] {
    if (Array.isArray(protocols)) return protocols.filter((protocol) => typeof protocol === "string" && protocol.length > 0);
    return typeof protocols === "string" && protocols.length > 0 ? [protocols] : [];
  }

  function collectFetchRequestHeaders(request: Request | null, init?: RequestInit): Record<string, string> {
    return {
      ...(request ? headersToObject(request.headers) : {}),
      ...headersInputToObject(init?.headers)
    };
  }

  function headersInputToObject(headers?: HeadersInit): Record<string, string> {
    if (!headers) return {};
    try {
      return headersToObject(new Headers(headers));
    } catch {
      return {};
    }
  }

  function stringifyReason(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    return serialize(reason);
  }

  function serialize(value: unknown): string {
    if (typeof value === "string") return truncate(value, settings.maxResponseLength);
    if (value instanceof Error) return value.stack || value.message;
    try {
      return truncate(JSON.stringify(value), settings.maxResponseLength);
    } catch {
      return String(value);
    }
  }

  function headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  function parseHeaderText(value: string): Record<string, string> {
    const result: Record<string, string> = {};
    value
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        const index = line.indexOf(":");
        if (index <= 0) return;
        result[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      });
    return result;
  }

  function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}\n...[TRUNCATED ${value.length - max} chars]`;
  }

  function randomId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : `devlite-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
})();
