const SAFE_SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "defs",
  "clippath",
  "mask",
  "lineargradient",
  "radialgradient",
  "stop",
  "title",
  "desc"
]);
const SAFE_SVG_ATTRS = new Set([
  "aria-hidden",
  "class",
  "clip-path",
  "clip-rule",
  "cx",
  "cy",
  "d",
  "fill",
  "fill-opacity",
  "fill-rule",
  "focusable",
  "fx",
  "fy",
  "gradienttransform",
  "gradientunits",
  "height",
  "id",
  "mask",
  "offset",
  "opacity",
  "points",
  "r",
  "role",
  "rx",
  "ry",
  "spreadmethod",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "transform",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2"
]);
const SAFE_SVG_URL_ATTRS = new Set(["clip-path", "mask"]);

export function imageReplacementTarget(element: HTMLElement): HTMLImageElement | HTMLSourceElement | SVGImageElement | null {
  if (element instanceof HTMLImageElement || element instanceof HTMLSourceElement) return element;
  return element.querySelector("img, source, image") as HTMLImageElement | HTMLSourceElement | SVGImageElement | null;
}

export function parseSvgMarkup(value: string): SVGSVGElement | null {
  if (!/^<svg[\s>]/i.test(value)) return null;
  const parsed = new DOMParser().parseFromString(value, "image/svg+xml");
  const svg = parsed.documentElement;
  if (parsed.querySelector("parsererror")) return null;
  if (svg.tagName.toLowerCase() !== "svg") return null;
  const imported = document.importNode(svg, true) as unknown as SVGSVGElement;
  sanitizeSvg(imported);
  normalizeSvgViewBox(imported);
  return imported;
}

export function looksLikeImageUrl(value: string): boolean {
  return /^(https?:|data:image\/|blob:|\/|\.\/|\.\.\/)/i.test(value) || /\.(svg|png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(value);
}

export function snapshotElementHtml(element: HTMLElement, redactInlineImages: boolean): string {
  const html = element.outerHTML;
  const normalized = redactInlineImages ? html.replace(/data:image\/[^"'\s)>]+/gi, "[inline image data]") : html;
  return normalized;
}

function sanitizeSvg(svg: SVGSVGElement): void {
  svg.querySelectorAll("*").forEach((element) => {
    if (!SAFE_SVG_ELEMENTS.has(element.tagName.toLowerCase())) {
      element.remove();
      return;
    }
    sanitizeSvgAttributes(element);
  });
  sanitizeSvgAttributes(svg);
}

function sanitizeSvgAttributes(element: Element): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value.trim();
    const lowerValue = value.toLowerCase();
    if (
      name.startsWith("on") ||
      !isSafeSvgAttributeName(name) ||
      lowerValue.startsWith("javascript:") ||
      hasUnsafeCssUrl(lowerValue) ||
      (SAFE_SVG_URL_ATTRS.has(name) && !isSafeSvgFragmentReference(value))
    ) {
      element.removeAttribute(attr.name);
    }
  }
}

function isSafeSvgAttributeName(name: string): boolean {
  return SAFE_SVG_ATTRS.has(name) || name.startsWith("aria-");
}

function isSafeSvgFragmentReference(value: string): boolean {
  return /^url\(\s*#[^)]+\s*\)$/i.test(value);
}

function hasUnsafeCssUrl(value: string): boolean {
  const urlMatches = value.match(/url\(([^)]+)\)/gi) ?? [];
  return urlMatches.some((match) => !/^url\(\s*#[^)]+\s*\)$/i.test(match));
}

function normalizeSvgViewBox(svg: SVGSVGElement): void {
  if (svg.hasAttribute("viewBox") || svg.hasAttribute("viewbox")) return;
  const width = parseSvgLength(svg.getAttribute("width"));
  const height = parseSvgLength(svg.getAttribute("height"));
  if (width && height) {
    svg.setAttribute("viewBox", `0 0 ${formatSvgNumber(width)} ${formatSvgNumber(height)}`);
    return;
  }
  svg.setAttribute("viewBox", "0 0 24 24");
}

function parseSvgLength(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatSvgNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
