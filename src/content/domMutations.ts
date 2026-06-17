import { truncateText } from "./utils";

export function imageReplacementTarget(element: HTMLElement): HTMLImageElement | HTMLSourceElement | SVGImageElement | null {
  if (element instanceof HTMLImageElement || element instanceof HTMLSourceElement) return element;
  return element.querySelector("img, source, image") as HTMLImageElement | HTMLSourceElement | SVGImageElement | null;
}

export function parseSvgMarkup(value: string): SVGSVGElement | null {
  if (!/^<svg[\s>]/i.test(value)) return null;
  const parsed = new DOMParser().parseFromString(value, "image/svg+xml");
  const svg = parsed.documentElement;
  if (!(svg instanceof SVGSVGElement) || svg.tagName.toLowerCase() !== "svg") return null;
  svg.querySelectorAll("script, foreignObject").forEach((node) => node.remove());
  return document.importNode(svg, true);
}

export function looksLikeImageUrl(value: string): boolean {
  return /^(https?:|data:image\/|blob:|\/|\.\/|\.\.\/)/i.test(value) || /\.(svg|png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(value);
}

export function snapshotElementHtml(element: HTMLElement, redactInlineImages: boolean): string {
  const html = element.outerHTML;
  const normalized = redactInlineImages ? html.replace(/data:image\/[^"'\s)>]+/gi, "[inline image data]") : html;
  return truncateText(normalized, 2400);
}
