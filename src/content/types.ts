import type { ContentLocale } from "./i18n";
import type { ArchivedStyleChange, ElementAncestor, ElementLocator, ImageEditMetadata, MatchedCssRule, StyleChange, StyleChangeArchiveReason } from "../shared/types";

export type { ArchivedStyleChange, ElementAncestor, ElementLocator, ImageEditMetadata, MatchedCssRule, StyleChange, StyleChangeArchiveReason };

export type InlineTextEditState = {
  element: HTMLElement;
  previousContentEditable: string | null;
  previousSpellcheck: string | null;
  onInput: () => void;
  onBlur: () => void;
  onKeydown: (event: KeyboardEvent) => void;
};

export type OverlayTab = "element" | "diagnostics" | "network" | "performance" | "settings";
export type NetworkDetailTab = "preview" | "response" | "request" | "headers";
export type DiagnosticFilter = "issues" | "logs";
export type UiLocale = ContentLocale;
export type UiTheme = "claude" | "saas" | "dark" | "cartoon";

export type PanelSettings = {
  locale?: UiLocale;
  uiTheme?: UiTheme;
  collectResponseBody?: boolean;
  maxResponseLength?: number;
  slowRequestThreshold?: number;
  retainHours?: number;
  extraRedactionKeys?: string[];
};

export type ThemeTokens = Record<
  | "bg"
  | "surface"
  | "surface2"
  | "sidebar"
  | "border"
  | "borderStrong"
  | "text"
  | "textMuted"
  | "primary"
  | "primaryHover"
  | "primarySoft"
  | "onPrimary"
  | "danger"
  | "warning"
  | "success"
  | "codeText"
  | "toastBg"
  | "shadow"
  | "focus",
  string
>;

export type FloatingPosition = {
  left: number;
  top: number;
  manual: boolean;
};

export type PerformanceIssue = {
  title: string;
  severity: "info" | "warning" | "error";
  detail: string;
  evidence: string[];
  suggestion: string;
};

export type PerformanceInsights = {
  metrics: Array<{ label: string; value: string; note: string }>;
  issues: PerformanceIssue[];
  largeResources: PerformanceResourceTiming[];
  slowResources: PerformanceResourceTiming[];
  longTasks: LiveDiagnosticEvent[];
};

export type LiveDiagnosticEvent = {
  id: string;
  type: string;
  severity: "info" | "warning" | "error";
  timestamp: number;
  message: string;
  source?: string;
  stack?: string;
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
  requestBody?: string;
  responseBody?: string;
  metadata?: Record<string, unknown>;
};

export type DiagnosticGroup = {
  key: string;
  severity: "info" | "warning" | "error";
  message: string;
  source: string;
  count: number;
  lastTimestamp: number;
  events: LiveDiagnosticEvent[];
};
