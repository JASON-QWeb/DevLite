import { ensureDomChangeBaseline, recordDomAfter } from "./changeManager";
import { imageReplacementTarget, looksLikeImageUrl, parseSvgMarkup } from "./domMutations";
import { cssStringEscape } from "./utils";
import type { ImageEditMetadata, StyleChange } from "./types";

export function applyImageReplacement(change: StyleChange, element: HTMLElement, src: string, action: string, imageEdit?: ImageEditMetadata): void {
  ensureDomChangeBaseline(change, element, action);
  change.imageEdit = imageEdit;

  const imageTarget = imageReplacementTarget(element);
  if (imageTarget instanceof HTMLImageElement) {
    imageTarget.src = src;
    imageTarget.removeAttribute("srcset");
  } else if (imageTarget instanceof HTMLSourceElement) {
    imageTarget.srcset = src;
  } else if (imageTarget instanceof SVGImageElement) {
    imageTarget.setAttribute("href", src);
    imageTarget.setAttributeNS("http://www.w3.org/1999/xlink", "href", src);
  } else {
    const before = getComputedStyle(element).getPropertyValue("background-image");
    if (change.before["background-image"] === undefined) {
      change.before["background-image"] = before;
    }
    element.style.setProperty("background-image", `url("${cssStringEscape(src)}")`);
    change.after["background-image"] = src.startsWith("data:image/") ? 'url("[inline image data]")' : `url("${cssStringEscape(src)}")`;
    change.domAction = action;
  }

  recordDomAfter(change, element);
}

export function applyIconReplacement(change: StyleChange, element: HTMLElement, value: string, action: string): void {
  ensureDomChangeBaseline(change, element, action);
  const svg = parseSvgMarkup(value);
  if (svg) {
    const existingSvg = element.querySelector("svg");
    if (existingSvg) {
      existingSvg.replaceWith(svg);
    } else {
      element.innerHTML = "";
      element.appendChild(svg);
    }
  } else if (looksLikeImageUrl(value)) {
    const img = element.querySelector("img") ?? document.createElement("img");
    img.src = value;
    img.alt = "";
    img.style.cssText = "width:1em;height:1em;object-fit:contain;display:inline-block;vertical-align:-0.125em;";
    if (!img.parentElement) {
      element.innerHTML = "";
      element.appendChild(img);
    }
  } else {
    element.textContent = value;
  }

  recordDomAfter(change, element);
}
