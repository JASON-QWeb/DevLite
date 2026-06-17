import { escapeHtml, truncate } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { DiagnosticFilter, DiagnosticGroup, LiveDiagnosticEvent } from "../types";

type DiagnosticsTabContext = {
  filter: DiagnosticFilter;
  issueEvents: LiveDiagnosticEvent[];
  logEvents: LiveDiagnosticEvent[];
  t: (key: ContentTextKey) => string;
  eventTypeLabel: (event: LiveDiagnosticEvent) => string;
  formatTime: (timestamp: number) => string;
  groupEvents: (events: LiveDiagnosticEvent[]) => DiagnosticGroup[];
};

export function renderDiagnosticsTabView(context: DiagnosticsTabContext): string {
  const { issueEvents, logEvents, filter, t } = context;
  const activeEvents = filter === "logs" ? logEvents : issueEvents;

  return `
      <div class="toolbar diagnostic-toolbar">
        <div class="filter-tabs" role="tablist" aria-label="${t("diagnostics")}">
          ${diagnosticFilterButton("issues", t("issueArchive"), issueEvents.length, filter)}
          ${diagnosticFilterButton("logs", "console.log", logEvents.length, filter)}
        </div>
        <button data-action="copy-all-errors" ${issueEvents.length === 0 ? "disabled" : ""}>${t("copyAllErrors")}</button>
      </div>
      ${
        activeEvents.length === 0
          ? `<div class="empty compact">${filter === "logs" ? t("noConsoleLogs") : t("noPageErrors")}</div>`
          : filter === "logs"
            ? renderConsoleLogList(logEvents, context)
            : renderDiagnosticArchive(issueEvents, context)
      }
    `;
}

function diagnosticFilterButton(filter: DiagnosticFilter, label: string, count: number, activeFilter: DiagnosticFilter): string {
  return `
      <button type="button" data-diagnostic-filter="${filter}" class="${activeFilter === filter ? "active" : ""}" role="tab" aria-selected="${activeFilter === filter}">
        <span>${escapeHtml(label)}</span>
        ${count > 0 ? `<strong>${count > 99 ? "99+" : count}</strong>` : ""}
      </button>
    `;
}

function renderDiagnosticArchive(events: LiveDiagnosticEvent[], context: DiagnosticsTabContext): string {
  const groups = context.groupEvents(events).slice(0, 24);
  return `
      <div class="diagnostic-list">
        ${groups.map((group, index) => renderDiagnosticGroup(group, index, context)).join("")}
      </div>
    `;
}

function renderDiagnosticGroup(group: DiagnosticGroup, index: number, context: DiagnosticsTabContext): string {
  const source = group.source || group.events.find((event) => event.source || event.url)?.source || group.events.find((event) => event.source || event.url)?.url || "";
  return `
      <details class="issue diagnostic-group ${group.severity}" data-state-key="diagnostic:${escapeHtml(group.key)}" ${index < 4 ? "open" : ""}>
        <summary class="issue-summary">
          <span>
            <strong>${escapeHtml(context.eventTypeLabel(group.events[0]))}</strong>
            <small>${escapeHtml(truncate(group.message, 120))}</small>
          </span>
          <b>${group.count}</b>
          <em>${context.formatTime(group.lastTimestamp)}</em>
        </summary>
        <p>${escapeHtml(group.message)}</p>
        ${source ? `<code>${escapeHtml(source)}</code>` : ""}
        <div class="issue-samples">
          ${group.events
            .slice(0, 4)
            .map(
              (event) => `
                <div class="issue-sample">
                  <span>${context.formatTime(event.timestamp)}</span>
                  ${event.source || event.url ? `<code>${escapeHtml(event.source || event.url || "")}</code>` : ""}
                  ${event.stack ? `<pre>${escapeHtml(truncate(event.stack, 360))}</pre>` : ""}
                </div>
              `
            )
            .join("")}
        </div>
      </details>
    `;
}

function renderConsoleLogList(events: LiveDiagnosticEvent[], context: DiagnosticsTabContext): string {
  return `
      <div class="diagnostic-list">
        ${events
          .slice(0, 60)
          .map(
            (event) => `
              <details class="issue console-log" data-state-key="console-log:${escapeHtml(event.id)}">
                <summary class="console-log-summary">
                  <span>
                    <strong>console.log</strong>
                    <small>${escapeHtml(truncate(event.message, 140))}</small>
                  </span>
                  <em>${context.formatTime(event.timestamp)}</em>
                </summary>
                <div class="console-log-body">
                  <p>${escapeHtml(event.message)}</p>
                  ${event.stack ? `<pre>${escapeHtml(truncate(event.stack, 360))}</pre>` : ""}
                </div>
              </details>
            `
          )
          .join("")}
      </div>
    `;
}
