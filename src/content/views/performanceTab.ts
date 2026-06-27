import { escapeHtml, formatBytes } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { LiveDiagnosticEvent, PanelSettings, PerformanceInsights, PerformanceIssue } from "../types";

type PerformanceTabContext = {
  insights: PerformanceInsights;
  settings: Required<PanelSettings>;
  settingsOpen: boolean;
  openIssueKeys: Set<string>;
  performanceEvents: LiveDiagnosticEvent[];
  resourceEntries: PerformanceResourceTiming[];
  t: (key: ContentTextKey) => string;
  formatResourceTiming: (resource: PerformanceResourceTiming) => string;
  formatUrl: (value: string) => string;
  formatTime: (timestamp: number) => string;
};

type MetricLookup = Map<string, { label: string; value: string; note: string }>;

export function performanceIssueKey(issue: PerformanceIssue): string {
  return `issue-${stableHash(JSON.stringify([issue.severity, issue.title, issue.detail, issue.evidence]))}`;
}

export function renderPerformanceTabView(context: PerformanceTabContext): string {
  const { insights, settingsOpen, t } = context;
  const metrics = metricLookup(insights.metrics);

  return `
      <div class="performance-panel">
        <div class="toolbar perf-toolbar">
          <button data-action="copy-performance-prompt" class="primary">${t("copyPerformancePrompt")}</button>
          <span class="perf-toolbar-meta">${insights.issues.length} ${t("performanceIssues")}</span>
          <button data-action="toggle-performance-settings" class="toolbar-group-right ${settingsOpen ? "active" : ""}">${settingsOpen ? t("hidePerformanceSettings") : t("performanceSettings")}</button>
        </div>
        ${settingsOpen ? renderPerformanceSettings(context) : ""}
        <section class="perf-overview">
          <div class="perf-vitals" aria-label="${t("webVitals")}">
            ${renderVital("LCP", metrics, context)}
            ${renderVital("INP", metrics, context)}
            ${renderVital("FID", metrics, context)}
            ${renderVital("CLS", metrics, context)}
          </div>
        </section>
        <section class="perf-live">
          <div class="perf-section-head">
            <strong>${t("runtimeMetrics")}</strong>
            <span>${t("performanceTrend")}</span>
          </div>
          <div class="perf-runtime-strip">
            ${renderRuntimeMetric("FPS", metrics)}
            ${renderRuntimeMetric("JS Heap", metrics)}
            ${renderRuntimeMetric(context.t("longTasks"), metrics)}
            ${renderRuntimeMetric(context.t("resourceSize"), metrics)}
          </div>
          ${renderTrend(context)}
        </section>
        ${renderResourceWaterfall(context)}
        ${renderPerformanceIssues(context)}
        ${renderPerformanceEvidence(context)}
      </div>
    `;
}

function renderPerformanceSettings(context: PerformanceTabContext): string {
  const { settings, t } = context;
  return `
      <section class="performance-settings-panel">
        <div class="perf-section-head">
          <strong>${t("performanceThresholds")}</strong>
          <span>${t("performanceSettings")}</span>
        </div>
        <div class="settings-fields performance-settings-grid">
          ${settingNumberField("performanceTtfbWarning", t("ttfbWarningThreshold"), settings.performanceTtfbWarning, "100", "10000", "100", t("thresholdMsHint"))}
          ${settingNumberField("performanceTtfbError", t("ttfbErrorThreshold"), settings.performanceTtfbError, "100", "20000", "100", t("thresholdMsHint"))}
          ${settingNumberField("performanceDomReadyWarning", t("domReadyWarningThreshold"), settings.performanceDomReadyWarning, "500", "30000", "100", t("thresholdMsHint"))}
          ${settingNumberField("performanceLoadWarning", t("loadWarningThreshold"), settings.performanceLoadWarning, "500", "60000", "100", t("thresholdMsHint"))}
          ${settingNumberField("performanceLoadError", t("loadErrorThreshold"), settings.performanceLoadError, "500", "120000", "100", t("thresholdMsHint"))}
          ${settingNumberField("performanceResourceSizeWarning", t("largeResourceThreshold"), settings.performanceResourceSizeWarning, "65536", "20971520", "65536", t("thresholdBytesHint"))}
        </div>
        <div class="settings-actions">
          <button data-action="reset-performance-settings">${t("resetDefaults")}</button>
          <button data-action="save-panel-settings" class="primary">${t("saveSettings")}</button>
        </div>
      </section>
    `;
}

function settingNumberField(name: string, label: string, value: number, min: string, max: string, step: string, hint: string): string {
  const fieldValue = Number.isFinite(value) ? String(value) : "";
  return `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input data-setting="${escapeHtml(name)}" type="number" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(fieldValue)}" />
        <small>${escapeHtml(hint)}</small>
      </label>
    `;
}

function renderVital(name: "LCP" | "INP" | "FID" | "CLS", metrics: MetricLookup, context: PerformanceTabContext): string {
  const metric = metrics.get(name.toLowerCase());
  const status = vitalStatus(name, metric?.value);
  return `
      <div class="perf-vital ${status}">
        <span>${name}</span>
        <strong>${escapeHtml(metric?.value ?? "-")}</strong>
        <small>${escapeHtml(metric?.note ?? context.t("webVitals"))}</small>
      </div>
    `;
}

function renderRuntimeMetric(label: string, metrics: MetricLookup): string {
  const metric = metrics.get(label.toLowerCase());
  return `
      <div class="perf-runtime-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(metric?.value ?? "-")}</strong>
        <small>${escapeHtml(metric?.note ?? "")}</small>
      </div>
    `;
}

function renderTrend(context: PerformanceTabContext): string {
  const samples = context.performanceEvents
    .filter((event) => ["fps", "memory", "inp", "fid", "cls", "lcp", "longtask"].includes(String(event.metadata?.kind ?? "")))
    .slice(-34);
  if (samples.length === 0) {
    return `<div class="perf-trend empty compact">${context.t("noPerformanceSamples")}</div>`;
  }
  const values = samples.map(sampleValue).filter((value) => Number.isFinite(value));
  const max = Math.max(1, ...values);
  return `
      <div class="perf-trend" aria-label="${context.t("performanceTrend")}">
        ${samples
          .map((event) => {
            const value = sampleValue(event);
            const safeValue = Number.isFinite(value) ? value : 0;
            const height = Math.max(10, Math.round((safeValue / max) * 100));
            const kind = String(event.metadata?.kind ?? "sample");
            const label = Number.isFinite(value) ? String(value) : "-";
            return `<i class="${event.severity}" style="height:${height}%" title="${escapeHtml(`${kind}: ${label} @ ${context.formatTime(event.timestamp)}`)}"></i>`;
          })
          .join("")}
      </div>
    `;
}

function sampleValue(event: LiveDiagnosticEvent): number {
  const kind = String(event.metadata?.kind ?? "");
  if (kind === "memory") return Number(event.metadata?.usedJSHeapSize ?? event.metadata?.value ?? 0);
  return Number(event.metadata?.value ?? event.duration ?? 0);
}

function renderResourceWaterfall(context: PerformanceTabContext): string {
  const resources = [...context.resourceEntries].sort((a, b) => a.startTime - b.startTime).slice(0, 28);
  if (resources.length === 0) return "";
  const end = Math.max(1, ...resources.map((resource) => resource.startTime + resource.duration));
  return `
      <section class="perf-waterfall">
        <div class="perf-section-head">
          <strong>${context.t("resourceWaterfall")}</strong>
          <span>${resources.length}</span>
        </div>
        <div class="perf-waterfall-list">
          ${resources.map((resource) => renderWaterfallRow(resource, end, context)).join("")}
        </div>
      </section>
    `;
}

function renderWaterfallRow(resource: PerformanceResourceTiming, timelineEnd: number, context: PerformanceTabContext): string {
  const start = Math.max(0, Math.round((resource.startTime / timelineEnd) * 100));
  const width = Math.max(1, Math.round((resource.duration / timelineEnd) * 100));
  const size = formatBytes(Math.max(resource.transferSize, resource.encodedBodySize));
  return `
      <div class="perf-waterfall-row">
        <span>${escapeHtml(resource.initiatorType || "resource")}</span>
        <div class="perf-waterfall-track">
          <i style="--start:${start}%;--width:${width}%"></i>
        </div>
        <code>${escapeHtml(`${Math.round(resource.duration)}ms / ${size} / ${context.formatUrl(resource.name)}`)}</code>
      </div>
    `;
}

function renderPerformanceIssues(context: PerformanceTabContext): string {
  const { insights, t } = context;
  if (insights.issues.length === 0) {
    return `<div class="empty compact">${t("noPerformanceRisk")}</div>`;
  }
  return `
      <section class="perf-issues-list">
        <div class="perf-section-head">
          <strong>${t("performanceIssues")}</strong>
          <span>${insights.issues.length}</span>
        </div>
        ${insights.issues.map((issue) => renderPerformanceIssue(issue, context.openIssueKeys.has(performanceIssueKey(issue)))).join("")}
      </section>
    `;
}

function renderPerformanceIssue(issue: PerformanceIssue, open: boolean): string {
  const key = performanceIssueKey(issue);
  return `
      <details class="perf-issue-row ${issue.severity}" data-performance-issue-key="${escapeHtml(key)}" ${open ? "open" : ""}>
        <summary data-performance-issue-toggle="${escapeHtml(key)}">
          <b>${escapeHtml(issue.severity)}</b>
          <span>${escapeHtml(issue.title)}</span>
          <small>${escapeHtml(issue.detail)}</small>
        </summary>
        <pre>${escapeHtml(issue.evidence.slice(0, 6).join("\n"))}</pre>
        <p>${escapeHtml(issue.suggestion)}</p>
      </details>
    `;
}

function stableHash(value: string): string {
  // Used only for UI toggle state; a rare collision only reuses a details open key.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function metricLookup(metrics: PerformanceInsights["metrics"]): MetricLookup {
  const lookup: MetricLookup = new Map();
  metrics.forEach((metric) => lookup.set(metric.label.toLowerCase(), metric));
  return lookup;
}

function vitalStatus(name: "LCP" | "INP" | "FID" | "CLS", value: string | undefined): string {
  const metric = Number((value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(metric)) return "missing";
  if (name === "LCP") return metric >= 4000 ? "error" : metric >= 2500 ? "warning" : "good";
  if (name === "INP") return metric >= 500 ? "error" : metric >= 200 ? "warning" : "good";
  if (name === "FID") return metric >= 300 ? "error" : metric >= 100 ? "warning" : "good";
  return metric >= 0.25 ? "error" : metric >= 0.1 ? "warning" : "good";
}
