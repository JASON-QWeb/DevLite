import type { DiagnosticSettings } from "./types";

export const DEFAULT_SETTINGS: DiagnosticSettings = {
  locale: "zh",
  collectResponseBody: false,
  maxResponseLength: 2048,
  slowRequestThreshold: 2000,
  retainHours: 24,
  extraRedactionKeys: [],
  ai: {
    mode: "off",
    provider: "openai",
    apiKey: "",
    model: "gpt-4.1-mini"
  }
};

export const SETTINGS_KEY = "devlite.settings";
