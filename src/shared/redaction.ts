import type { DiagnosticEvent, DiagnosticSettings, DiagnosticSession } from "./types";

const DEFAULT_SENSITIVE_KEYS = [
  "password",
  "passwd",
  "pwd",
  "token",
  "access_token",
  "refresh_token",
  "secret",
  "api_key",
  "apikey",
  "x-api-key",
  "authorization",
  "cookie",
  "set-cookie",
  "csrf",
  "csrf-token",
  "phone",
  "email",
  "idcard",
  "creditcard",
  "cardnumber"
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;
const BEARER_RE = /bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_RE = /(["']?(?:access_token|refresh_token|token|authorization|apiKey|api_key|secret)["']?\s*[:=]\s*["']?)[^"',&}\s]+/gi;
const CARD_RE = /(?<!\d)(?:\d[ -]*?){13,19}(?!\d)/g;

export function sensitiveKeys(settings?: DiagnosticSettings): string[] {
  return [...DEFAULT_SENSITIVE_KEYS, ...(settings?.extraRedactionKeys ?? [])].map((key) => key.toLowerCase());
}

export function redactText(value: unknown, settings?: DiagnosticSettings): string {
  if (value === null || value === undefined) {
    return "";
  }

  let text = typeof value === "string" ? value : safeStringify(value);
  const maxLength = Math.max(256, settings?.maxResponseLength ?? 2048);

  text = text
    .replace(EMAIL_RE, "[REDACTED_EMAIL]")
    .replace(PHONE_RE, "[REDACTED_PHONE]")
    .replace(BEARER_RE, "Bearer [REDACTED_TOKEN]")
    .replace(TOKEN_RE, "$1[REDACTED]")
    .replace(CARD_RE, (match) => (isLikelyCardNumber(match) ? "[REDACTED_CARD]" : match));

  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}\n...[TRUNCATED ${text.length - maxLength} chars]`;
  }

  return text;
}

export function redactObject<T>(value: T, settings?: DiagnosticSettings): T {
  const keys = sensitiveKeys(settings).map(normalizeKey);

  function walk(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(walk);
    }

    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(input)) {
        if (keys.includes(normalizeKey(key))) {
          out[key] = "[REDACTED]";
        } else {
          out[key] = walk(child);
        }
      }
      return out;
    }

    if (typeof input === "string") {
      return redactText(input, settings);
    }

    return input;
  }

  return walk(value) as T;
}

export function sanitizeEvent(event: DiagnosticEvent, settings: DiagnosticSettings): DiagnosticEvent {
  const redacted = redactObject(event, settings);
  return {
    ...redacted,
    message: stringValue(redacted.message),
    stack: redacted.stack ? stringValue(redacted.stack) : undefined,
    requestBody: redacted.requestBody ? stringValue(redacted.requestBody) : undefined,
    responseBody: settings.collectResponseBody && redacted.responseBody ? stringValue(redacted.responseBody) : undefined
  };
}

export function sanitizeSession(session: DiagnosticSession, settings: DiagnosticSettings): DiagnosticSession {
  return {
    ...session,
    page: redactObject(session.page, settings),
    events: (session.events ?? []).map((event) => sanitizeEvent(event, settings)),
    styleChanges: (session.styleChanges ?? []).map((change) => redactObject(change, settings)),
    archivedStyleChanges: (session.archivedStyleChanges ?? []).map((item) => ({
      ...item,
      change: redactObject(item.change, settings)
    }))
  };
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, child) => {
        if (typeof child === "bigint") {
          return child.toString();
        }
        if (typeof child === "object" && child !== null) {
          if (seen.has(child)) {
            return "[Circular]";
          }
          seen.add(child);
        }
        if (typeof child === "function") {
          return `[Function ${child.name || "anonymous"}]`;
        }
        return child;
      },
      2
    );
  } catch {
    return String(value);
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, "");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : safeStringify(value);
}

function isLikelyCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}
