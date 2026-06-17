import { escapeHtml } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { PerformanceInsights, PerformanceIssue } from "../types";

type PerformanceTabContext = {
  insights: PerformanceInsights;
  t: (key: ContentTextKey) => string;
  formatResourceTiming: (resource: PerformanceResourceTiming) => string;
  formatTime: (timestamp: number) => string;
};

export function renderPerformanceTabView(context: PerformanceTabContext): string {
  const { insights, t } = context;
  return `
      <div class="toolbar">
        <button data-action="copy-performance-prompt" class="primary">${t("copyPerformancePrompt")}</button>
      </div>
      <div class="perf-metrics">
        ${insights.metrics.map((metric) => `<div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span><small>${escapeHtml(metric.note)}</small></div>`).join("")}
      </div>
      ${
        insights.issues.length === 0
          ? `<div class="empty compact">${t("noPerformanceRisk")}</div>`
          : `<div class="perf-issues">${insights.issues.map(renderPerformanceIssue).join("")}</div>`
      }
      ${renderPerformanceEvidence(context)}
    `;
}

function renderPerformanceIssue(issue: PerformanceIssue): string {
  return `
      <article class="perf-issue ${issue.severity}">
        <div class="issue-head">
          <strong>${escapeHtml(issue.title)}</strong>
          <span>${escapeHtml(issue.severity)}</span>
        </div>
        <p>${escapeHtml(issue.detail)}</p>
        <pre>${escapeHtml(issue.evidence.slice(0, 6).join("\n"))}</pre>
        <p>${escapeHtml(issue.suggestion)}</p>
      </article>
    `;
}

function renderPerformanceEvidence(context: PerformanceTabContext): string {
  const resources = context.insights.largeResources.slice(0, 6);
  const slowResources = context.insights.slowResources.slice(0, 6);
  const longTasks = context.insights.longTasks.slice(0, 6);
  if (resources.length === 0 && slowResources.length === 0 && longTasks.length === 0) return "";
  return `
      <div class="perf-evidence">
        ${resources.length > 0 ? `<section><strong>${context.t("largeResources")}</strong>${resources.map((resource) => `<code>${escapeHtml(context.formatResourceTiming(resource))}</code>`).join("")}</section>` : ""}
        ${slowResources.length > 0 ? `<section><strong>${context.t("slowResources")}</strong>${slowResources.map((resource) => `<code>${escapeHtml(context.formatResourceTiming(resource))}</code>`).join("")}</section>` : ""}
        ${longTasks.length > 0 ? `<section><strong>${context.t("longTasks")}</strong>${longTasks.map((event) => `<code>${escapeHtml(`${event.duration ?? 0}ms @ ${context.formatTime(event.timestamp)}`)}</code>`).join("")}</section>` : ""}
      </div>
    `;
}
