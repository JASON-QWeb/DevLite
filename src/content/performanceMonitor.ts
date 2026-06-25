import type { LiveDiagnosticEvent, PerformanceInsights, UiLocale } from "./types";
import { getMemoryInfo } from "./performanceMemory";
import { formatBytes } from "./utils";

type PerformanceMonitorOptions = {
  isCaptureActive: () => boolean;
  getInsights: () => PerformanceInsights;
  getLocale: () => UiLocale;
  sendDiagnosticEvent: (event: Record<string, unknown>) => void;
};

export class PerformanceMonitor {
  private observers: PerformanceObserver[] = [];
  private snapshotSent = false;
  private cumulativeLayoutShift = 0;
  private maxInteractionDuration = 0;
  private fpsFrameId: number | null = null;
  private fpsWindowStarted = 0;
  private fpsFrames = 0;
  private memoryTimerId: number | null = null;
  private lastMemoryWarningAt = 0;

  constructor(private readonly options: PerformanceMonitorOptions) {}

  start(): void {
    if (this.observers.length > 0 || this.fpsFrameId !== null || this.memoryTimerId !== null) {
      this.sendSnapshotOnce();
      return;
    }
    if (typeof PerformanceObserver !== "undefined") {
      this.observe("longtask", (entry) => this.handleLongTask(entry));
      this.observe("largest-contentful-paint", (entry) => this.handleLargestContentfulPaint(entry));
      this.observe("layout-shift", (entry) => this.handleLayoutShift(entry));
      this.observe("event", (entry) => this.handleInteraction(entry));
      this.observe("first-input", (entry) => this.handleFirstInput(entry));
    }
    this.startFpsMonitor();
    this.startMemoryMonitor();
    this.sendSnapshotOnce();
  }

  stop(): void {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
    this.snapshotSent = false;
    this.cumulativeLayoutShift = 0;
    this.maxInteractionDuration = 0;
    if (this.fpsFrameId !== null) {
      window.cancelAnimationFrame(this.fpsFrameId);
      this.fpsFrameId = null;
    }
    if (this.memoryTimerId !== null) {
      window.clearInterval(this.memoryTimerId);
      this.memoryTimerId = null;
    }
    this.lastMemoryWarningAt = 0;
    this.fpsWindowStarted = 0;
    this.fpsFrames = 0;
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

  private observe(type: string, handleEntry: (entry: PerformanceEntry) => void): void {
    try {
      const observer = new PerformanceObserver((list) => {
        if (!this.options.isCaptureActive()) return;
        for (const entry of list.getEntries()) {
          handleEntry(entry);
        }
      });
      observer.observe({ type, buffered: true } as PerformanceObserverInit);
      this.observers.push(observer);
    } catch {
      // Unsupported entry types vary by browser version; keep other observers active.
    }
  }

  private handleLongTask(entry: PerformanceEntry): void {
    if (entry.duration < 50) return;
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

  private handleLargestContentfulPaint(entry: PerformanceEntry): void {
    const value = Math.round(entry.startTime);
    this.options.sendDiagnosticEvent({
      type: "performance",
      severity: value >= 4000 ? "error" : value >= 2500 ? "warning" : "info",
      message: webVitalMessage(this.options.getLocale(), "LCP", `${value}ms`),
      duration: value,
      metadata: {
        kind: "lcp",
        value,
        startTime: value
      }
    });
  }

  private handleLayoutShift(entry: PerformanceEntry): void {
    const layoutShift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
    if (layoutShift.hadRecentInput || typeof layoutShift.value !== "number") return;
    this.cumulativeLayoutShift = Math.round((this.cumulativeLayoutShift + layoutShift.value) * 1000) / 1000;
    this.options.sendDiagnosticEvent({
      type: "performance",
      severity: this.cumulativeLayoutShift >= 0.25 ? "error" : this.cumulativeLayoutShift >= 0.1 ? "warning" : "info",
      message: webVitalMessage(this.options.getLocale(), "CLS", this.cumulativeLayoutShift.toFixed(3)),
      metadata: {
        kind: "cls",
        value: this.cumulativeLayoutShift,
        startTime: Math.round(entry.startTime)
      }
    });
  }

  private handleInteraction(entry: PerformanceEntry): void {
    const interaction = entry as PerformanceEntry & { interactionId?: number };
    if (!interaction.interactionId || entry.duration < 40 || entry.duration <= this.maxInteractionDuration) return;
    this.maxInteractionDuration = Math.round(entry.duration);
    this.options.sendDiagnosticEvent({
      type: "performance",
      severity: this.maxInteractionDuration >= 500 ? "error" : this.maxInteractionDuration >= 200 ? "warning" : "info",
      message: webVitalMessage(this.options.getLocale(), "INP", `${this.maxInteractionDuration}ms`),
      duration: this.maxInteractionDuration,
      metadata: {
        kind: "inp",
        name: entry.name,
        value: this.maxInteractionDuration,
        startTime: Math.round(entry.startTime)
      }
    });
  }

  private handleFirstInput(entry: PerformanceEntry): void {
    const firstInput = entry as PerformanceEntry & { processingStart?: number };
    if (typeof firstInput.processingStart !== "number") return;
    const value = Math.max(0, Math.round(firstInput.processingStart - entry.startTime));
    this.options.sendDiagnosticEvent({
      type: "performance",
      severity: value >= 300 ? "error" : value >= 100 ? "warning" : "info",
      message: webVitalMessage(this.options.getLocale(), "FID", `${value}ms`),
      duration: value,
      metadata: {
        kind: "fid",
        name: entry.name,
        value,
        startTime: Math.round(entry.startTime)
      }
    });
  }

  private startFpsMonitor(): void {
    if (this.fpsFrameId !== null) return;
    if (!this.options.isCaptureActive()) return;
    const tick = (timestamp: number): void => {
      if (!this.options.isCaptureActive()) {
        this.fpsFrameId = null;
        this.fpsWindowStarted = 0;
        this.fpsFrames = 0;
        return;
      }
      if (this.fpsWindowStarted === 0) {
        this.fpsWindowStarted = timestamp;
        this.fpsFrames = 0;
      }
      this.fpsFrames += 1;
      const elapsed = timestamp - this.fpsWindowStarted;
      if (elapsed >= 3000) {
        const fps = Math.round((this.fpsFrames * 1000) / elapsed);
        this.options.sendDiagnosticEvent({
          type: "performance",
          severity: fps < 30 ? "error" : fps < 40 ? "warning" : "info",
          message: webVitalMessage(this.options.getLocale(), "FPS", String(fps)),
          metadata: {
            kind: "fps",
            value: fps,
            windowMs: Math.round(elapsed)
          }
        });
        this.fpsWindowStarted = timestamp;
        this.fpsFrames = 0;
      }
      this.fpsFrameId = window.requestAnimationFrame(tick);
    };
    this.fpsFrameId = window.requestAnimationFrame(tick);
  }

  private startMemoryMonitor(): void {
    if (this.memoryTimerId !== null) return;
    if (!this.options.isCaptureActive()) return;
    const reportMemory = (): void => {
      if (!this.options.isCaptureActive()) {
        if (this.memoryTimerId !== null) {
          window.clearInterval(this.memoryTimerId);
          this.memoryTimerId = null;
        }
        return;
      }
      const memory = getMemoryInfo();
      if (!memory) return;
      const ratio = memory.jsHeapSizeLimit > 0 ? memory.usedJSHeapSize / memory.jsHeapSizeLimit : 0;
      const now = Date.now();
      if (ratio < 0.8 || now - this.lastMemoryWarningAt >= 30000) {
        if (ratio >= 0.8) {
          this.lastMemoryWarningAt = now;
        }
        this.options.sendDiagnosticEvent({
          type: "performance",
          severity: ratio >= 0.8 ? "warning" : "info",
          message: memoryMessage(this.options.getLocale(), memory.usedJSHeapSize, memory.jsHeapSizeLimit),
          metadata: {
            kind: "memory",
            value: Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10,
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
            ratio: Math.round(ratio * 1000) / 1000
          }
        });
      }
    };
    reportMemory();
    this.memoryTimerId = window.setInterval(reportMemory, 5000);
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

function webVitalMessage(locale: UiLocale, name: string, value: string): string {
  return locale === "en" ? `${name} measured at ${value}` : `${name} 指标为 ${value}`;
}

function memoryMessage(locale: UiLocale, used: number, limit: number): string {
  return locale === "en"
    ? `JS heap ${formatBytes(used)} / ${formatBytes(limit)}`
    : `JS 堆内存 ${formatBytes(used)} / ${formatBytes(limit)}`;
}
