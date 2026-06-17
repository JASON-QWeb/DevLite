export type DiagnosticEventType =
  | "js-error"
  | "unhandled-rejection"
  | "console-error"
  | "network"
  | "resource-error"
  | "user-click"
  | "performance";

export type Severity = "info" | "warning" | "error";
export type UiLocale = "zh" | "en";

export interface DiagnosticSettings {
  locale: UiLocale;
  collectResponseBody: boolean;
  maxResponseLength: number;
  slowRequestThreshold: number;
  retainHours: number;
  extraRedactionKeys: string[];
  ai: AiSettings;
}

export interface AiSettings {
  mode: "off" | "user-key";
  provider: "openai" | "deepseek" | "anthropic" | "gemini";
  apiKey: string;
  model: string;
}

export interface PageContext {
  url: string;
  title: string;
  userAgent: string;
  language: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  startedAt: number;
  endedAt?: number;
}

export interface DiagnosticEvent {
  id: string;
  type: DiagnosticEventType;
  severity: Severity;
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
}

export interface StyleChange {
  id: string;
  selector: string;
  elementLabel: string;
  textSnippet: string;
  domPath: string;
  locator?: ElementLocator;
  viewport: {
    width: number;
    height: number;
  };
  before: Record<string, string>;
  after: Record<string, string>;
  textBefore?: string;
  textAfter?: string;
  htmlBefore?: string;
  htmlAfter?: string;
  updatedAt: number;
  note?: string;
}

export interface ElementLocator {
  tagName: string;
  id: string;
  classList: string[];
  attributes: Record<string, string>;
  openingTag: string;
  outerHTMLSnippet: string;
  selector: string;
  domPath: string;
  parentChain: ElementAncestor[];
  matchedCssRules: MatchedCssRule[];
}

export interface ElementAncestor {
  tagName: string;
  id: string;
  classList: string[];
  selector: string;
}

export interface MatchedCssRule {
  selectorText: string;
  style: string;
  source: string;
  condition?: string;
}

export interface DiagnosticSession {
  id: string;
  tabId: number;
  active: boolean;
  page: PageContext;
  events: DiagnosticEvent[];
  styleChanges: StyleChange[];
  createdAt: number;
  updatedAt: number;
}

export interface AnalysisFinding {
  title: string;
  detail: string;
  severity: Severity;
  evidence: string[];
  suggestion: string;
}

export interface AnalysisResult {
  summary: string;
  findings: AnalysisFinding[];
  counters: {
    jsErrors: number;
    promiseErrors: number;
    consoleErrors: number;
    failedRequests: number;
    slowRequests: number;
    resourceErrors: number;
    styleChanges: number;
  };
}

export type ExportFormat = "ai" | "markdown" | "json";

export interface AiAnalysisResult {
  provider: AiSettings["provider"];
  model: string;
  content: string;
  createdAt: number;
}
