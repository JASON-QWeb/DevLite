export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

export function truncateText(value: string, max: number): string {
  return truncate(value, max);
}

export function formatTime(timestamp: number, locale: "zh" | "en"): string {
  return new Date(timestamp).toLocaleTimeString(locale === "en" ? "en-US" : "zh-CN", { hour12: false });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0KB";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

export function cssBlock(styles: Record<string, string>, emptyText: string): string {
  const entries = Object.entries(styles).filter(([, value]) => value);
  if (entries.length === 0) return emptyText;
  return entries.map(([key, value]) => `${key}: ${value};`).join("\n");
}

export function toHexColor(value: string): string {
  const match = value.match(/rgba?\(\s*([\d.]+%?)(?:\s*,\s*|\s+)([\d.]+%?)(?:\s*,\s*|\s+)([\d.]+%?)/i);
  if (!match) return "#000000";
  return `#${[match[1], match[2], match[3]].map((part) => cssColorChannelToHex(part)).join("")}`;
}

export function normalizeFontWeight(value: string): string {
  if (/^\d+$/.test(value)) return value;
  if (value === "bold") return "700";
  if (value === "normal") return "400";
  return "400";
}

export function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function cssStringEscape(value: string): string {
  return value
    .replace(/\0/g, "\uFFFD")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\)/g, "\\)")
    .replace(/[\n\r\f]/g, "");
}

export function randomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `devlite-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cssColorChannelToHex(value: string): string {
  const numeric = value.endsWith("%") ? (Number(value.slice(0, -1)) / 100) * 255 : Number(value);
  const clamped = Math.min(255, Math.max(0, Math.round(Number.isFinite(numeric) ? numeric : 0)));
  return clamped.toString(16).padStart(2, "0");
}
