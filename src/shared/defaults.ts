import type { DiagnosticSettings } from "./types";

export const DEFAULT_SETTINGS: DiagnosticSettings = {
  locale: "zh",
  uiTheme: "claude",
  collectResponseBody: false,
  maxResponseLength: 2048,
  slowRequestThreshold: 2000,
  retainHours: 24,
  extraRedactionKeys: []
};

export const SETTINGS_KEY = "devlite.settings";
