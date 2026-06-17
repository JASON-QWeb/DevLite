const DANGEROUS_SVG_ELEMENTS = "script, foreignObject, use, animate, animateMotion, animateTransform, set";
const URL_ATTRS = new Set(["href", "xlink:href", "src"]);

export function imageReplacementTarget(element: HTMLElement): HTMLImageElement | HTMLSourceElement | SVGImageElement | null {
  if (element instanceof HTMLImageElement || element instanceof HTMLSourceElement) return element;
  return element.querySelector("img, source, image") as HTMLImageElement | HTMLSourceElement | SVGImageElement | null;
}

export function parseSvgMarkup(value: string): SVGSVGElement | null {
  if (!/^<svg[\s>]/i.test(value)) return null;
  const parsed = new DOMParser().parseFromString(value, "image/svg+xml");
  const svg = parsed.documentElement;
  if (parsed.querySelector("parsererror")) return null;
  if (!(svg instanceof SVGSVGElement) || svg.tagName.toLowerCase() !== "svg") return null;
  sanitizeSvg(svg);
  return document.importNode(svg, true);
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
  svg.querySelectorAll(DANGEROUS_SVG_ELEMENTS).forEach((node) => node.remove());
  svg.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const lowerValue = value.toLowerCase();
      if (
        name.startsWith("on") ||
        lowerValue.startsWith("javascript:") ||
        lowerValue.includes("url(javascript:") ||
        (URL_ATTRS.has(name) && !isSafeSvgUrl(value))
      ) {
        element.removeAttribute(attr.name);
      }
    }
  });
}

function isSafeSvgUrl(value: string): boolean {
  return /^(#|https?:\/\/|data:image\/|blob:|\/|\.\/|\.\.\/)/i.test(value);
}
