type NetworkEventLike = {
  type?: string;
  method?: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

const DEV_PROTOCOL_PATTERNS = [
  /vite/i,
  /hmr/i,
  /webpack/i,
  /livereload/i,
  /react-refresh/i,
  /^(?:next|next-hmr|nextjs(?:[-:]?hmr)?|nextjs)$/i
];

const DEV_URL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "vite-hmr", pattern: /(?:^|\/)@vite(?:\/|$)|__vite_ping|vite-hmr/i },
  { name: "webpack-hmr", pattern: /webpack-hmr|__webpack_hmr|webpack-dev-server|hot-update/i },
  { name: "next-hmr", pattern: /\/_next\/webpack-hmr(?:\?|$|\/)|nextjs_original-stack-frame/i },
  { name: "livereload", pattern: /livereload|live-reload/i },
  { name: "sockjs", pattern: /sockjs-node|sockjs\/|sockjs-websocket/i },
  { name: "react-refresh", pattern: /react-refresh/i },
  { name: "hmr", pattern: /(?:^|\/)(?:hmr|__hmr|hot)(?:\?|$|\/)/i }
];

const LOCAL_DEV_PORTS = new Set(["3000", "3001", "4200", "5173", "5174", "8000", "8080"]);

export function classifyDevelopmentTransport(
  url: string | undefined,
  protocols: readonly string[] = [],
  source: string | undefined = undefined,
  baseUrl: string | undefined = undefined
): Record<string, unknown> {
  const devTransport = developmentTransportName({ url, protocols, source, baseUrl });
  return devTransport ? { devTransport } : {};
}

export function isDevelopmentNetworkEvent(event: NetworkEventLike): boolean {
  if (event.type !== "network") return false;
  const metadata = event.metadata ?? {};
  if (typeof metadata.devTransport === "string" && metadata.devTransport.length > 0) return true;
  return Boolean(
    developmentTransportName({
      url: event.url,
      protocols: metadataStringList(metadata.protocols),
      source: typeof metadata.source === "string" ? metadata.source : event.method
    })
  );
}

function developmentTransportName(input: { url?: string; protocols?: readonly string[]; source?: string; baseUrl?: string }): string | null {
  const protocols = input.protocols ?? [];
  const protocolMatch = protocols.find((protocol) => DEV_PROTOCOL_PATTERNS.some((pattern) => pattern.test(protocol)));
  if (protocolMatch) return normalizeDevTransport(protocolMatch);

  const source = (input.source ?? "").toLowerCase();
  const isLongConnection = source === "websocket" || source === "eventsource" || source === "ws" || source === "sse";
  if (!isLongConnection) return null;

  const parsed = parseUrl(input.url, input.baseUrl);
  const target = parsed ? `${parsed.pathname}${parsed.search}` : input.url ?? "";
  const urlMatch = DEV_URL_PATTERNS.find((item) => item.pattern.test(target));
  if (urlMatch) return urlMatch.name;

  if (parsed && isLocalDevHost(parsed.hostname) && LOCAL_DEV_PORTS.has(parsed.port) && /^\/(?:ws|hmr|__hmr)?\/?$/i.test(parsed.pathname)) {
    return "local-dev-ws";
  }

  return null;
}

function normalizeDevTransport(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("vite")) return "vite-hmr";
  if (normalized.includes("webpack")) return "webpack-hmr";
  if (normalized.includes("next")) return "next-hmr";
  if (normalized.includes("live")) return "livereload";
  if (normalized.includes("refresh")) return "react-refresh";
  return "hmr";
}

function parseUrl(value: string | undefined, baseUrl: string | undefined = undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    // Continue with an explicit or environment base for relative URLs.
  }
  const base = baseUrl ?? currentLocationHref();
  if (!base) return null;
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function currentLocationHref(): string | undefined {
  const locationLike = (globalThis as { location?: { href?: unknown } }).location;
  return typeof locationLike?.href === "string" ? locationLike.href : undefined;
}

function isLocalDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function metadataStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}
