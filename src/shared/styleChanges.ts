import type { DiagnosticSession } from "./types";

export function promptableStyleChanges(styleChanges: DiagnosticSession["styleChanges"]): DiagnosticSession["styleChanges"] {
  return (styleChanges ?? []).filter((change) => !change.exportedAt);
}
