import type { DiagnosticGroup, LiveDiagnosticEvent } from "./types";

type DiagnosticGroupOptions = {
  eventTypeLabel: (event: LiveDiagnosticEvent) => string;
  formatUrl: (value: string) => string;
};

type DiagnosticEventSender = (events: LiveDiagnosticEvent[]) => void;

export class DiagnosticEventBatcher {
  private queue: LiveDiagnosticEvent[] = [];
  private flushTimer: number | null = null;

  constructor(
    private readonly sendEvents: DiagnosticEventSender,
    private readonly flushDelay = 500,
    private readonly batchSize = 50
  ) {}

  enqueue(event: LiveDiagnosticEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.batchSize) {
      this.flush();
      return;
    }
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => this.flush(), this.flushDelay);
  }

  flush(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0, this.queue.length);
    this.sendEvents(events);
  }
}

export class DiagnosticEventStore {
  private events: LiveDiagnosticEvent[] = [];

  get all(): LiveDiagnosticEvent[] {
    return this.events;
  }

  remember(event: LiveDiagnosticEvent): void {
    if (!event?.id) return;
    const index = this.events.findIndex((item) => item.id === event.id);
    if (index >= 0) {
      this.events[index] = event;
    } else {
      this.events.push(event);
    }
    this.events = this.events.sort((a, b) => a.timestamp - b.timestamp).slice(-220);
  }

  merge(events: LiveDiagnosticEvent[]): void {
    events.forEach((event) => this.remember(event));
  }

  getProblemEvents(): LiveDiagnosticEvent[] {
    return this.events
      .filter((event) => {
        if (event.type === "performance" || event.type === "user-click") return false;
        if (event.type === "network") return event.severity === "error" || (typeof event.status === "number" && event.status >= 400);
        return event.severity === "error" || event.severity === "warning";
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  getNetworkEvents(): LiveDiagnosticEvent[] {
    return this.events.filter((event) => event.type === "network").sort((a, b) => b.timestamp - a.timestamp);
  }

  getConsoleLogEvents(): LiveDiagnosticEvent[] {
    return this.events.filter((event) => event.type === "console-log").sort((a, b) => b.timestamp - a.timestamp);
  }

  group(events: LiveDiagnosticEvent[], options: DiagnosticGroupOptions): DiagnosticGroup[] {
    const groups = new Map<string, DiagnosticGroup>();
    for (const event of events) {
      const key = diagnosticGroupKey(event, options.formatUrl);
      const group = groups.get(key);
      if (group) {
        group.events.push(event);
        group.count += 1;
        group.lastTimestamp = Math.max(group.lastTimestamp, event.timestamp);
        group.severity = maxSeverity(group.severity, event.severity);
        continue;
      }
      groups.set(key, {
        key,
        severity: event.severity,
        message: event.message || options.eventTypeLabel(event),
        source: event.url || event.source || "",
        count: 1,
        lastTimestamp: event.timestamp,
        events: [event]
      });
    }
    return Array.from(groups.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count || b.lastTimestamp - a.lastTimestamp);
  }
}

function diagnosticGroupKey(event: LiveDiagnosticEvent, formatUrl: (value: string) => string): string {
  const status = typeof event.status === "number" ? String(event.status) : "";
  const source = event.url ? formatUrl(event.url) : event.source || "";
  const message = normalizeDiagnosticMessage(event.message);
  return [event.type, status, source, message].join("|");
}

function normalizeDiagnosticMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, "{url}")
    .replace(/\b\d{10,}\b/g, "{number}")
    .replace(/\b[0-9a-f]{8,}\b/gi, "{hash}")
    .slice(0, 180);
}

function maxSeverity(a: LiveDiagnosticEvent["severity"], b: LiveDiagnosticEvent["severity"]): LiveDiagnosticEvent["severity"] {
  return severityRank(b) > severityRank(a) ? b : a;
}

function severityRank(severity: LiveDiagnosticEvent["severity"]): number {
  if (severity === "error") return 3;
  if (severity === "warning") return 2;
  return 1;
}
