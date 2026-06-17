import type { LiveDiagnosticEvent, PerformanceInsights, UiLocale } from "./types";

type PerformanceMonitorOptions = {
  isCaptureActive: () => boolean;
  getInsights: () => PerformanceInsights;
  getLocale: () => UiLocale;
  sendDiagnosticEvent: (event: Record<string, unknown>) => void;
};

export class PerformanceMonitor {
  private observer: PerformanceObserver | null = null;
  private snapshotSent = false;

  constructor(private readonly options: PerformanceMonitorOptions) {}

  start(): void {
    if (this.observer || typeof PerformanceObserver === "undefined") {
      this.sendSnapshotOnce();
      return;
    }
    try {
      this.observer = new PerformanceObserver((list) => {
        if (!this.options.isCaptureActive()) return;
        for (const entry of list.getEntries()) {
          if (entry.duration < 50) continue;
          this.options.sendDiagnosticEvent({
            type: "performance",
            severity: entry.duration >= 200 ? "error" : "warning",
            message: longTaskMessage(this.options.getLocale(), entry.duration),
            duration: Math.round(entry.duration),
            metadata: {
              kind: "longtask",
              name: entry.name,
              startTime: Math.round(entry.startTime)
            }
          });
        }
      });
      this.observer.observe({ entryTypes: ["longtask"] });
    } catch {
      this.observer = null;
    }
    this.sendSnapshotOnce();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.snapshotSent = false;
  }

  sendSnapshotOnce(): void {
    if (this.snapshotSent || !this.options.isCaptureActive()) return;
    this.snapshotSent = true;
    const insights = this.options.getInsights();
    const locale = this.options.getLocale();
    this.options.sendDiagnosticEvent({
      type: "performance",
      severity: insights.issues.length > 0 ? "warning" : "info",
      message: snapshotMessage(locale, insights.issues.length),
      metadata: {
        kind: "snapshot",
        metrics: insights.metrics,
        issueTitles: insights.issues.map((issue) => issue.title)
      }
    });
  }
}

function longTaskMessage(locale: UiLocale, duration: number): string {
  return locale === "en" ? `Main thread long task ${Math.round(duration)}ms` : `主线程长任务 ${Math.round(duration)}ms`;
}

function snapshotMessage(locale: UiLocale, issueCount: number): string {
  if (issueCount > 0) {
    return locale === "en" ? `Performance snapshot found ${issueCount} risks` : `性能快照发现 ${issueCount} 个风险`;
  }
  return locale === "en" ? "Performance snapshot found no obvious risks" : "性能快照未发现明显风险";
}
