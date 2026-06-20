export type DiagnosticEventType =
  | "js-error"
  | "unhandled-rejection"
  | "console-error"
  | "console-log"
  | "network"
  | "resource-error"
  | "user-click"
  | "performance";

export type Severity = "info" | "warning" | "error";
export type UiLocale = "zh" | "en";
export type UiTheme = "claude" | "saas" | "dark" | "cartoon";
export type StyleChangeVerificationStatus = "waiting" | "failed";
export type StyleChangeArchiveReason = "verified" | "manual";

export interface ImageEditMetadata {
  mode: "crop";
  source: {
    name: string;
    type: string;
    size: number;
    width: number;
    height: number;
  };
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    aspectRatio: number | null;
  };
  output: {
    width: number;
    height: number;
    type: string;
  };
}

export interface DiagnosticSettings {
  locale: UiLocale;
  uiTheme: UiTheme;
  collectResponseBody: boolean;
  maxResponseLength: number;
  slowRequestThreshold: number;
  retainHours: number;
  extraRedactionKeys: string[];
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
  domBefore?: string;
  domAfter?: string;
  domAction?: string;
  imageEdit?: ImageEditMetadata;
  exportedAt?: number;
  exportedPageLoadId?: string;
  exportedMutationVersion?: number;
  verificationStatus?: StyleChangeVerificationStatus;
  lastVerifiedAt?: number;
  lastVerifyReason?: string;
  updatedAt: number;
  note?: string;
}

export interface ArchivedStyleChange {
  change: StyleChange;
  archivedAt: number;
  archiveReason: StyleChangeArchiveReason;
  verificationReason?: string;
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
  archivedStyleChanges: ArchivedStyleChange[];
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

export type ExportFormat = "prompt" | "markdown" | "json";
