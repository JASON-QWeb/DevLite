import {
  detailRow,
  formatMetadataValue,
  formatNetworkStatus,
  hasResponseBody,
  networkStatusClass
} from "../networkDetails";
import { escapeHtml } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { LiveDiagnosticEvent, NetworkDetailTab } from "../types";

type NetworkTabContext = {
  events: LiveDiagnosticEvent[];
  selected: LiveDiagnosticEvent | null;
  detailTab: NetworkDetailTab;
  slowThreshold: number;
  t: (key: ContentTextKey) => string;
  formatUrl: (value: string) => string;
  summarizeNetworkData: (event: LiveDiagnosticEvent) => string;
  renderPayloadPanel: (value: string | undefined, emptyText: string) => string;
};

export function pickSelectedNetworkEvent(events: LiveDiagnosticEvent[], selectedId: string | null): LiveDiagnosticEvent | null {
  const selected = selectedId ? events.find((event) => event.id === selectedId) : null;
  return selected ?? events[0] ?? null;
}

export function renderNetworkTabView(context: NetworkTabContext): string {
  const { events, selected, t, slowThreshold } = context;
  if (events.length === 0) {
    return `<div class="empty compact">${t("noNetworkData")}</div>`;
  }

  const failed = events.filter((event) => event.severity === "error" || (typeof event.status === "number" && event.status >= 400)).length;
  const slow = events.filter((event) => typeof event.duration === "number" && event.duration >= slowThreshold).length;
  const responseCount = events.filter(hasResponseBody).length;

  return `
      <div class="toolbar network-toolbar">
        <button data-action="copy-all-responses" ${responseCount === 0 ? "disabled" : ""}>${t("copyAllResponses")}</button>
      </div>
      <div class="network-summary">
        <div><strong>${events.length}</strong><span>${t("latestRequests")}</span></div>
        <div><strong>${failed}</strong><span>${t("failed")}</span></div>
        <div><strong>${slow}</strong><span>${t("slow")}</span></div>
      </div>
      <div class="network-workspace">
        <div class="network-list" role="list">
          ${events.map((event) => renderNetworkListItem(event, selected?.id === event.id, context)).join("")}
        </div>
        <section class="network-detail">
          ${selected ? renderNetworkDetail(selected, context) : `<div class="empty compact">${t("selectRequest")}</div>`}
        </section>
      </div>
    `;
}

function renderNetworkListItem(event: LiveDiagnosticEvent, selected: boolean, context: NetworkTabContext): string {
  const statusClass = networkStatusClass(event);
  return `
      <button type="button" class="network-row ${selected ? "selected" : ""}" data-network-id="${escapeHtml(event.id)}" role="listitem">
        <span class="network-method">${escapeHtml(event.method || "GET")}</span>
        <span class="network-url">${escapeHtml(context.formatUrl(event.url || ""))}</span>
        <span class="network-status ${statusClass}">${escapeHtml(formatNetworkStatus(event))}</span>
        <span class="network-hint">${escapeHtml(context.summarizeNetworkData(event))}</span>
      </button>
    `;
}

function renderNetworkDetail(event: LiveDiagnosticEvent, context: NetworkTabContext): string {
  return `
      <div class="network-detail-head">
        <div>
          <strong>${escapeHtml(event.method || "GET")} ${escapeHtml(context.formatUrl(event.url || ""))}</strong>
          <span>${escapeHtml(event.url || "")}</span>
        </div>
        <b class="${networkStatusClass(event)}">${escapeHtml(formatNetworkStatus(event))}</b>
      </div>
      <div class="detail-tabs">
        ${networkDetailButton("preview", "Preview", context.detailTab)}
        ${networkDetailButton("response", "Response", context.detailTab)}
        ${networkDetailButton("request", "Request", context.detailTab)}
        ${networkDetailButton("headers", "Headers", context.detailTab)}
      </div>
      ${renderNetworkDetailBody(event, context)}
    `;
}

function networkDetailButton(tab: NetworkDetailTab, label: string, activeTab: NetworkDetailTab): string {
  return `<button type="button" data-network-detail="${tab}" class="${activeTab === tab ? "active" : ""}">${label}</button>`;
}

function renderNetworkDetailBody(event: LiveDiagnosticEvent, context: NetworkTabContext): string {
  if (context.detailTab === "response") {
    return context.renderPayloadPanel(event.responseBody, context.t("responseAutoCollecting"));
  }
  if (context.detailTab === "request") {
    return `
        <div class="detail-grid">
          ${detailRow("Method", event.method || "GET")}
          ${detailRow("URL", event.url || "")}
          ${detailRow("Request body", event.requestBody || context.t("none"))}
        </div>
      `;
  }
  if (context.detailTab === "headers") {
    return renderNetworkHeaders(event, context);
  }
  return renderNetworkPreview(event, context);
}

function renderNetworkPreview(event: LiveDiagnosticEvent, context: NetworkTabContext): string {
  const contentType = typeof event.metadata?.contentType === "string" ? event.metadata.contentType : "";
  const source = typeof event.metadata?.source === "string" ? event.metadata.source : "network";
  const body = event.responseBody || "";
  return `
      <div class="detail-grid compact">
        ${detailRow("Source", source)}
        ${detailRow("Content-Type", contentType || "unknown")}
        ${detailRow("Duration", typeof event.duration === "number" ? `${event.duration}ms` : "-")}
        ${detailRow("Status", typeof event.status === "number" ? String(event.status) : event.severity)}
      </div>
      ${
        body
          ? context.renderPayloadPanel(body, context.t("noResponseBody"))
          : `<div class="empty compact">${context.t("responseAutoCollecting")}</div>`
      }
    `;
}

function renderNetworkHeaders(event: LiveDiagnosticEvent, context: NetworkTabContext): string {
  const requestHeaders = event.metadata?.requestHeaders;
  const responseHeaders = event.metadata?.responseHeaders;
  return `
      <div class="detail-grid">
        ${detailRow("Request headers", formatMetadataValue(requestHeaders) || context.t("none"))}
        ${detailRow("Response headers", formatMetadataValue(responseHeaders) || context.t("none"))}
        ${detailRow("Meta", formatMetadataValue(event.metadata))}
      </div>
    `;
}
