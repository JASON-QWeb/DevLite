(() => {
  const win = window as any;
  if (win.__DEVLITE_PAGE_INSTALLED__) {
    return;
  }
  win.__DEVLITE_PAGE_INSTALLED__ = true;

  const PAGE_CHANNEL = "devlite:page";
  const CONTROL_CHANNEL = "devlite:control";
  let active = false;
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

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CONTROL_CHANNEL) return;
    if (data.type === "start") {
      active = true;
      settings = { ...settings, ...(data.settings ?? {}) };
      emit({
        type: "performance",
        severity: "info",
        message: "DevLite 已开始诊断当前页面",
        metadata: getPerformanceSnapshot()
      });
    }
    if (data.type === "stop") {
      active = false;
    }
  });

  window.addEventListener("error", (event) => {
    if (!active) return;
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
    if (!active) return;
    emit({
      type: "unhandled-rejection",
      severity: "error",
      message: stringifyReason(event.reason),
      stack: event.reason?.stack
    });
  });

  console.error = (...args: unknown[]) => {
    if (active) {
      emit({
        type: "console-error",
        severity: "error",
        message: args.map(serialize).join(" "),
        stack: new Error("console.error").stack
      });
    }
    originalConsoleError(...args);
  };

  console.log = (...args: unknown[]) => {
    if (active) {
      emit({
        type: "console-log",
        severity: "info",
        message: args.map(serialize).join(" "),
        stack: new Error("console.log").stack,
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
    const requestBody = summarizeBody(init?.body);

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
      } else if (active) {
        emit(baseEvent);
      }

      return response;
    } catch (error) {
      if (active) {
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
            error: serialize(error)
          }
        });
      }
      throw error;
    }
  };

  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    (this as any).__devlite = {
      method,
      url: String(url),
      headers: {},
      startedAt: 0
    };
    return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name: string, value: string) {
    const meta = (this as any).__devlite;
    if (meta) {
      meta.headers[name] = value;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this;
    const meta = (xhr as any).__devlite ?? {};
    meta.startedAt = performance.now();
    meta.requestBody = summarizeBody(body);
    (xhr as any).__devlite = meta;

    const finalize = (kind: "loadend" | "error" | "timeout" | "abort") => {
      if (!active) return;
      const duration = Math.round(performance.now() - meta.startedAt);
      const status = xhr.status || undefined;
      const responseText = settings.collectResponseBody && typeof xhr.responseText === "string" ? truncate(xhr.responseText, settings.maxResponseLength) : undefined;
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

  function emit(event: any): void {
    window.postMessage(
      {
        channel: PAGE_CHANNEL,
        event: {
          id: randomId(),
          timestamp: Date.now(),
          ...event
        }
      },
      "*"
    );
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
