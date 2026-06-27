import type { LiveDiagnosticEvent, NetworkDetailTab } from "./types";

export function buildNetworkEventText(event: LiveDiagnosticEvent): string {
  return [
    `${event.method ?? "GET"} ${event.url ?? ""}`,
    `Status: ${typeof event.status === "number" ? event.status : event.severity}`,
    `Duration: ${typeof event.duration === "number" ? `${event.duration}ms` : "-"}`,
    `Time: ${new Date(event.timestamp).toISOString()}`,
    "",
    "[Request headers]",
    formatUnknown(event.metadata?.requestHeaders) || "-",
    "",
    "[Request body]",
    event.requestBody || "-",
    "",
    "[Response headers]",
    formatUnknown(event.metadata?.responseHeaders) || "-",
    "",
    "[Response body]",
    event.responseBody || "-"
  ].join("\n");
}

export function buildNetworkDetailText(event: LiveDiagnosticEvent, tab: NetworkDetailTab): string {
  if (tab === "response") {
    return event.responseBody || "-";
  }
  if (tab === "request") {
    return [
      `[Request]`,
      `${event.method ?? "GET"} ${event.url ?? ""}`,
      "",
      "[Request headers]",
      formatUnknown(event.metadata?.requestHeaders) || "-",
      "",
      "[Request body]",
      event.requestBody || "-"
    ].join("\n");
  }
  if (tab === "headers") {
    return [
      "[Request headers]",
      formatUnknown(event.metadata?.requestHeaders) || "-",
      "",
      "[Response headers]",
      formatUnknown(event.metadata?.responseHeaders) || "-",
      "",
      "[Meta]",
      formatUnknown(event.metadata) || "-"
    ].join("\n");
  }
  const contentType = typeof event.metadata?.contentType === "string" ? event.metadata.contentType : "";
  const source = typeof event.metadata?.source === "string" ? event.metadata.source : "network";
  return [
    `[Preview]`,
    `${event.method ?? "GET"} ${event.url ?? ""}`,
    `Source: ${source}`,
    `Content-Type: ${contentType || "unknown"}`,
    `Duration: ${typeof event.duration === "number" ? `${event.duration}ms` : "-"}`,
    `Status: ${typeof event.status === "number" ? event.status : event.severity}`,
    "",
    "[Response body]",
    event.responseBody || "-"
  ].join("\n");
}

export function buildCurlCommand(event: LiveDiagnosticEvent): string {
  const parts = ["curl", "-X", shellQuote(event.method ?? "GET"), shellQuote(event.url ?? "")];
  const headers = event.metadata?.requestHeaders;
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    Object.entries(headers as Record<string, unknown>).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      parts.push("-H", shellQuote(`${key}: ${String(value)}`));
    });
  }
  if (event.requestBody) {
    parts.push("--data-raw", shellQuote(event.requestBody));
  }
  return parts.join(" ");
}

function formatUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildAllErrorsText(events: LiveDiagnosticEvent[], eventTypeLabel: (event: LiveDiagnosticEvent) => string): string {
  if (events.length === 0) return "";
  return events
    .map((event, index) => {
      return [
        `#${index + 1} [${event.severity}] ${eventTypeLabel(event)}`,
        `Time: ${new Date(event.timestamp).toISOString()}`,
        event.url ? `URL: ${event.url}` : "",
        event.source ? `Source: ${event.source}` : "",
        typeof event.status === "number" ? `Status: ${event.status}` : "",
        event.method ? `Method: ${event.method}` : "",
        event.message ? `Message: ${event.message}` : "",
        event.stack ? `Stack:\n${event.stack}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}
