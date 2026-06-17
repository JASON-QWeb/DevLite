import { escapeHtml, truncate } from "./utils";
import type { LiveDiagnosticEvent, UiLocale } from "./types";

export type NetworkSummaryText = {
  emptyData: string;
  objectFields: string;
  noResponseBodyCollected: string;
};

export function hasResponseBody(event: LiveDiagnosticEvent): boolean {
  return typeof event.responseBody === "string" && event.responseBody.length > 0;
}

export function summarizeNetworkData(event: LiveDiagnosticEvent, text: NetworkSummaryText, locale: UiLocale): string {
  const body = event.responseBody || event.requestBody || "";
  if (body) return summarizePayload(body, text, locale);
  const contentType = typeof event.metadata?.contentType === "string" ? event.metadata.contentType : "";
  const source = typeof event.metadata?.source === "string" ? event.metadata.source : "network";
  return [contentType, source, typeof event.duration === "number" ? `${event.duration}ms` : ""].filter(Boolean).join(" / ") || text.noResponseBodyCollected;
}

export function renderPayloadPanel(value: string | undefined, emptyText: string, locale: UiLocale): string {
  if (!value) return `<div class="empty compact">${escapeHtml(emptyText)}</div>`;
  const trimmed = value.trim();
  if (!trimmed) return `<div class="empty compact">${escapeHtml(emptyText)}</div>`;
  const parsed = parseJsonPayload(trimmed);
  if (parsed.ok) {
    return `<div class="payload-preview">${renderJsonPreview(parsed.value, 0, locale)}</div>`;
  }
  return `<pre class="payload-raw">${escapeHtml(truncate(trimmed, 6000))}</pre>`;
}

export function detailRow(label: string, value: string): string {
  return `
      <div class="detail-row">
        <span>${escapeHtml(label)}</span>
        <code>${escapeHtml(value)}</code>
      </div>
    `;
}

export function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function networkStatusClass(event: LiveDiagnosticEvent): string {
  if (event.severity === "error" || (typeof event.status === "number" && event.status >= 400)) return "bad";
  if (event.severity === "warning") return "warn";
  return "ok";
}

export function formatNetworkStatus(event: LiveDiagnosticEvent): string {
  const status = typeof event.status === "number" ? String(event.status) : event.severity;
  const duration = typeof event.duration === "number" ? `${event.duration}ms` : "";
  return [status, duration].filter(Boolean).join(" / ");
}

function summarizePayload(value: string, text: NetworkSummaryText, locale: UiLocale): string {
  const trimmed = value.trim();
  if (!trimmed) return text.emptyData;
  try {
    const json = JSON.parse(trimmed);
    if (Array.isArray(json)) {
      const first = json[0] && typeof json[0] === "object" ? Object.keys(json[0]).slice(0, 5).join(", ") : "";
      return locale === "en" ? `Array ${json.length} items${first ? ` / ${first}` : ""}` : `数组 ${json.length} 项${first ? ` / ${first}` : ""}`;
    }
    if (json && typeof json === "object") {
      return `${text.objectFields} / ${Object.keys(json).slice(0, 8).join(", ")}`;
    }
    return truncate(String(json), 160);
  } catch {
    return truncate(trimmed.replace(/\s+/g, " "), 180);
  }
}

function parseJsonPayload(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function renderJsonPreview(value: unknown, depth: number, locale: UiLocale): string {
  if (depth > 4) {
    return `<span class="json-muted">...</span>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `<span class="json-muted">[]</span>`;
    const visible = value.slice(0, 8);
    return `
        <div class="json-node">
          <strong>Array(${value.length})</strong>
          ${visible.map((item, index) => `<div class="json-row"><span>${index}</span>${renderJsonPreview(item, depth + 1, locale)}</div>`).join("")}
          ${value.length > visible.length ? `<div class="json-muted">${locale === "en" ? `${value.length - visible.length} more items` : `还有 ${value.length - visible.length} 项`}</div>` : ""}
        </div>
      `;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `<span class="json-muted">{}</span>`;
    return `
        <div class="json-node">
          ${entries
            .slice(0, 18)
            .map(([key, item]) => `<div class="json-row"><span>${escapeHtml(key)}</span>${renderJsonPreview(item, depth + 1, locale)}</div>`)
            .join("")}
          ${entries.length > 18 ? `<div class="json-muted">${locale === "en" ? `${entries.length - 18} more fields` : `还有 ${entries.length - 18} 个字段`}</div>` : ""}
        </div>
      `;
  }
  if (typeof value === "string") return `<code>${escapeHtml(truncate(value, 360))}</code>`;
  if (value === null) return `<span class="json-muted">null</span>`;
  return `<code>${escapeHtml(String(value))}</code>`;
}
