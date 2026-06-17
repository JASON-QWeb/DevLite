import { hasResponseBody } from "./networkDetails";
import type { LiveDiagnosticEvent } from "./types";

export function buildAllResponsesText(events: LiveDiagnosticEvent[]): string {
  const responseEvents = events.filter(hasResponseBody);
  if (responseEvents.length === 0) return "";
  return responseEvents
    .map((event, index) => {
      return [
        `#${index + 1} ${event.method ?? "GET"} ${event.url ?? ""}`,
        `Status: ${typeof event.status === "number" ? event.status : event.severity}`,
        `Duration: ${typeof event.duration === "number" ? `${event.duration}ms` : "-"}`,
        `Time: ${new Date(event.timestamp).toISOString()}`,
        "",
        event.responseBody ?? ""
      ].join("\n");
    })
    .join("\n\n---\n\n");
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
