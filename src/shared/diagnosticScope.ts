import type { DiagnosticScope } from "./types";

type DiagnosticEventLike = {
  type?: string;
  severity?: string;
  status?: number;
  metadata?: Record<string, unknown>;
};

export type { DiagnosticScope };

export function diagnosticScopeMetadata(scope: DiagnosticScope): Record<string, unknown> {
  return {
    pageLoadId: scope.pageLoadId,
    diagnosticGeneration: scope.diagnosticGeneration,
    mutationVersion: scope.mutationVersion
  };
}

export function isAutoClearDiagnosticEvent(event: DiagnosticEventLike): boolean {
  if (
    event.type === "js-error" ||
    event.type === "unhandled-rejection" ||
    event.type === "console-error" ||
    event.type === "console-log" ||
    event.type === "resource-error"
  ) {
    return true;
  }
  if (event.type === "network") {
    return event.severity === "error" || (typeof event.status === "number" && event.status >= 400);
  }
  return false;
}

export function isCurrentDiagnosticScopeEvent(event: DiagnosticEventLike, scope: DiagnosticScope): boolean {
  const metadata = event.metadata ?? {};
  return metadata.pageLoadId === scope.pageLoadId && metadata.diagnosticGeneration === scope.diagnosticGeneration;
}

export function isStaleDiagnosticScopeEvent(event: DiagnosticEventLike, scope: DiagnosticScope): boolean {
  return isAutoClearDiagnosticEvent(event) && !isCurrentDiagnosticScopeEvent(event, scope);
}
