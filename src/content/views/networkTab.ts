import {
  detailRow,
  formatMetadataValue,
  formatNetworkStatus,
  networkStatusClass
} from "../networkDetails";
import { escapeHtml } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { LiveDiagnosticEvent, NetworkDetailTab } from "../types";

type NetworkTabContext = {
  events: LiveDiagnosticEvent[];
  totalCount: number;
  matchedCount: number;
  selected: LiveDiagnosticEvent | null;
  detailTab: NetworkDetailTab;
  filterErrorsOnly: boolean;
  showDevelopmentTraffic: boolean;
  searchQuery: string;
  listWidth: number;
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
  const { events, matchedCount, selected, t, slowThreshold, totalCount, filterErrorsOnly, showDevelopmentTraffic, searchQuery } = context;

  const failed = events.filter((event) => event.severity === "error" || (typeof event.status === "number" && event.status >= 400)).length;
  const slow = events.filter((event) => typeof event.duration === "number" && event.duration >= slowThreshold).length;
  const maxDuration = Math.max(1, ...events.map((event) => Number(event.duration ?? 0)));

  return `
      <div class="network-panel">
        <div class="toolbar network-toolbar">
          <button data-action="copy-selected-network" class="primary" ${selected ? "" : "disabled"}>${t("copySelectedRequest")}</button>
          <button data-action="copy-selected-curl" ${selected ? "" : "disabled"}>${t("copyCurl")}</button>
          <button data-action="clear-network-events" ${totalCount === 0 ? "disabled" : ""}>${t("clearNetworkData")}</button>
          <button data-action="toggle-network-errors" class="${filterErrorsOnly ? "active" : ""}" ${totalCount === 0 ? "disabled" : ""}>${t("errorsOnly")}</button>
          <button data-action="toggle-development-network" class="${showDevelopmentTraffic ? "active" : ""}" ${totalCount === 0 ? "disabled" : ""}>${t("developmentTraffic")}</button>
          <input data-network-search type="search" value="${escapeHtml(searchQuery)}" placeholder="${t("searchRequests")}" ${totalCount === 0 ? "disabled" : ""} />
        </div>
        <div class="network-summary">
          <div><strong>${events.length}</strong><span>${t("latestRequests")}</span></div>
          <div><strong>${failed}</strong><span>${t("failed")}</span></div>
          <div><strong>${slow}</strong><span>${t("slow")}</span></div>
          <div><strong>${matchedCount}</strong><span>${t("showingRequests")}</span></div>
        </div>
        ${
          events.length === 0
            ? `<div class="empty compact">${filterErrorsOnly ? t("noNetworkErrors") : t("noNetworkData")}</div>`
            : `<div class="network-workspace" style="--network-list-width: ${Math.round(context.listWidth)}px">
                <div class="network-list" role="list">
                  ${events.map((event) => renderNetworkListItem(event, selected?.id === event.id, maxDuration, context)).join("")}
                </div>
                <button type="button" class="network-splitter" data-network-splitter aria-label="${t("resizeNetworkList")}"></button>
                <section class="network-detail">
                  ${selected ? renderNetworkDetail(selected, context) : `<div class="empty compact">${t("selectRequest")}</div>`}
                </section>
              </div>`
        }
      </div>
    `;
}

function renderNetworkListItem(event: LiveDiagnosticEvent, selected: boolean, maxDuration: number, context: NetworkTabContext): string {
  const statusClass = networkStatusClass(event);
  const status = typeof event.status === "number" ? String(event.status) : event.severity;
  const duration = typeof event.duration === "number" ? `${event.duration}ms` : "-";
  const barWidth = typeof event.duration === "number" ? Math.max(4, Math.round((event.duration / maxDuration) * 100)) : 0;
  return `
      <button type="button" class="network-row ${selected ? "selected" : ""}" data-network-id="${escapeHtml(event.id)}" role="listitem" aria-pressed="${selected}">
        ${barWidth > 0 ? `<i class="network-waterfall" style="width:${barWidth}%"></i>` : ""}
        <span class="network-method-stack">
          <span class="network-method">${escapeHtml(event.method || "GET")}</span>
          <span class="network-code ${statusClass}">${escapeHtml(status)}</span>
          <span class="network-duration">${escapeHtml(duration)}</span>
        </span>
        <span class="network-url">${escapeHtml(context.formatUrl(event.url || ""))}</span>
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
        ${networkDetailButton("preview", context.t("preview"), context.detailTab)}
        ${networkDetailButton("response", context.t("response"), context.detailTab)}
        ${networkDetailButton("request", context.t("request"), context.detailTab)}
        ${networkDetailButton("headers", context.t("headers"), context.detailTab)}
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
    const requestHeaders = formatMetadataValue(event.metadata?.requestHeaders);
    return `
        <div class="detail-grid">
          ${detailRow("Method", event.method || "GET")}
          ${detailRow("URL", event.url || "")}
          ${detailRow("Request headers", requestHeaders || context.t("none"))}
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
