export type IconifyIconAsset = {
  id: string;
  prefix: string;
  name: string;
  label: string;
  svg: string;
};

export type IconifySearchDependencies = {
  fetchSearchIds: (query: string) => Promise<string[]>;
  fetchAsset: (id: string) => Promise<IconifyIconAsset | null>;
  assetConcurrency?: number;
};

export const ICONIFY_API_URL = "https://api.iconify.design";
export const ICONIFY_REQUEST_TIMEOUT = 8000;

const DEFAULT_ASSET_CONCURRENCY = 4;

export async function searchIconifyIconAssets(message: any, deps: IconifySearchDependencies): Promise<IconifyIconAsset[]> {
  const queries = normalizeStringList(message.queries ?? message.query, 6, 64);
  const prefixes = normalizeStringList(message.prefixes, 10, 32).filter(isIconifyName);
  const limit = clampNumber(message.limit, 1, 24, 18);
  if (queries.length === 0) return [];

  const searchResults = await Promise.allSettled(queries.map((query) => deps.fetchSearchIds(query)));
  const iconIds = searchResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  if (iconIds.length === 0 && searchResults.some((result) => result.status === "rejected")) {
    throw new Error("Iconify search failed");
  }

  const rankedIds = rankIconifyIds(iconIds, prefixes);
  const candidates = rankedIds.slice(0, limit * 2);
  return collectIconifyAssets(candidates, deps.fetchAsset, limit, deps.assetConcurrency ?? DEFAULT_ASSET_CONCURRENCY);
}

export async function fetchIconifySearchIds(query: string): Promise<string[]> {
  const url = new URL(`${ICONIFY_API_URL}/search`);
  url.searchParams.set("query", query);
  const data = await fetchJsonWithTimeout(url.toString());
  const icons = (data as { icons?: unknown[] }).icons;
  return Array.isArray(icons) ? icons.filter((item): item is string => typeof item === "string" && splitIconifyId(item) !== null) : [];
}

export async function fetchIconifySvg(prefix: string, name: string): Promise<string> {
  if (!isIconifyName(prefix) || !isIconifyName(name)) {
    throw new Error("Invalid Iconify icon");
  }
  const url = `${ICONIFY_API_URL}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
  const svg = await fetchTextWithTimeout(url, "image/svg+xml");
  if (!/^<svg[\s>]/i.test(svg.trim())) {
    throw new Error("Invalid Iconify SVG");
  }
  return svg;
}

export async function fetchIconifyAsset(id: string): Promise<IconifyIconAsset | null> {
  const parsed = splitIconifyId(id);
  if (!parsed) return null;
  try {
    const svg = await fetchIconifySvg(parsed.prefix, parsed.name);
    return {
      id: `${parsed.prefix}:${parsed.name}`,
      prefix: parsed.prefix,
      name: parsed.name,
      label: iconifyLabel(parsed.name),
      svg
    };
  } catch {
    return null;
  }
}

export function splitIconifyId(id: string): { prefix: string; name: string } | null {
  const separatorIndex = id.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex !== id.lastIndexOf(":")) return null;
  const prefix = id.slice(0, separatorIndex);
  const name = id.slice(separatorIndex + 1);
  return isIconifyName(prefix) && isIconifyName(name) ? { prefix, name } : null;
}

export function isIconifyName(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

export function iconifyLabel(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().replace(/\s+/g, " ").slice(0, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function rankIconifyIds(iconIds: string[], prefixes: string[]): string[] {
  const firstSeen = new Map<string, number>();
  for (const id of iconIds) {
    if (splitIconifyId(id) && !firstSeen.has(id)) {
      firstSeen.set(id, firstSeen.size);
    }
  }

  return Array.from(firstSeen.keys()).sort((a, b) => {
    const aPrefix = splitIconifyId(a)?.prefix ?? "";
    const bPrefix = splitIconifyId(b)?.prefix ?? "";
    const aPrefixRank = preferredPrefixRank(prefixes, aPrefix);
    const bPrefixRank = preferredPrefixRank(prefixes, bPrefix);
    return aPrefixRank - bPrefixRank || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
  });
}

async function collectIconifyAssets(
  candidates: string[],
  fetchAsset: (id: string) => Promise<IconifyIconAsset | null>,
  limit: number,
  concurrency: number
): Promise<IconifyIconAsset[]> {
  const safeConcurrency = clampNumber(concurrency, 1, 8, DEFAULT_ASSET_CONCURRENCY);
  const icons: IconifyIconAsset[] = [];
  for (let index = 0; index < candidates.length && icons.length < limit; index += safeConcurrency) {
    const batch = candidates.slice(index, index + safeConcurrency);
    const results = await Promise.all(batch.map(fetchAsset));
    for (const icon of results) {
      if (icon) icons.push(icon);
      if (icons.length >= limit) break;
    }
  }
  return icons;
}

function preferredPrefixRank(prefixes: string[], prefix: string): number {
  const rank = prefixes.indexOf(prefix);
  return rank >= 0 ? rank : prefixes.length + 1;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const text = await fetchTextWithTimeout(url, "application/json");
  return JSON.parse(text);
}

async function fetchTextWithTimeout(url: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ICONIFY_REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}
