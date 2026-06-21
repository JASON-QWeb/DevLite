import type { DiagnosticSettings } from "./types";

export const DEFAULT_SETTINGS: DiagnosticSettings = {
  locale: "zh",
  uiTheme: "claude",
  collectResponseBody: false,
  maxResponseLength: 2048,
  slowRequestThreshold: 2000,
  performanceTtfbWarning: 800,
  performanceTtfbError: 1200,
  performanceDomReadyWarning: 2500,
  performanceLoadWarning: 4500,
  performanceLoadError: 8000,
  performanceResourceSizeWarning: 512 * 1024,
  retainHours: 24,
  extraRedactionKeys: []
};

export const SETTINGS_KEY = "devlite.settings";
