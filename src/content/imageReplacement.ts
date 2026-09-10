import { computedStyle, documentOf, isHtmlElement, type InspectableElement } from "./domContext";
import { ensureDomChangeBaseline, recordDomAfter, rememberRelatedDomBaseline } from "./changeManager";
import { imageReplacementTarget, looksLikeImageUrl, parseSvgMarkup } from "./domMutations";
import { cssStringEscape } from "./utils";
import type { ImageEditMetadata, StyleChange } from "./types";

export function applyImageReplacement(change: StyleChange, element: InspectableElement, src: string, action: string, imageEdit?: ImageEditMetadata): void {
  ensureDomChangeBaseline(change, element, action);
  change.imageEdit = imageEdit;

  const imageTarget = imageReplacementTarget(element);
  if (imageTarget?.localName === "img") {
    imageTarget.setAttribute("src", src);
    imageTarget.closest("picture")?.querySelectorAll("source").forEach((source) => { rememberRelatedDomBaseline(change, source); source.setAttribute("srcset", src); });
    imageTarget.removeAttribute("srcset");
  } else if (imageTarget?.localName === "source") {
    imageTarget.setAttribute("srcset", src);
  } else if (imageTarget?.localName === "image") {
    imageTarget.setAttribute("href", src);
    imageTarget.setAttributeNS("http://www.w3.org/1999/xlink", "href", src);
  } else {
    const before = computedStyle(element).getPropertyValue("background-image");
    if (change.before["background-image"] === undefined) {
      change.before["background-image"] = before;
    }
    change.inlineBefore ??= {};
    change.inlineBefore["background-image"] ??= { value: element.style.getPropertyValue("background-image"), priority: element.style.getPropertyPriority("background-image") };
    element.style.setProperty("background-image", `url("${cssStringEscape(src)}")`);
    change.after["background-image"] = src.startsWith("data:image/") ? 'url("[inline image data]")' : `url("${cssStringEscape(src)}")`;
    change.domAction = action;
  }

  recordDomAfter(change, element);
}

export function applyIconReplacement(change: StyleChange, element: InspectableElement, value: string, action: string): void {
  const svg = parseSvgMarkup(value, documentOf(element));
  if (!svg && !isHtmlElement(element)) throw new Error("SVG elements require a valid SVG icon.");
  ensureDomChangeBaseline(change, element, action);
  if (svg) {
    if (element.localName === "svg") {
      element.replaceChildren(...Array.from(svg.childNodes));
      for (const attr of Array.from(svg.attributes)) if (!["id", "class", "style"].includes(attr.name)) element.setAttribute(attr.name, attr.value);
      recordDomAfter(change, element);
      return;
    }
    const existingSvg = element.querySelector("svg");
    if (existingSvg) {
      existingSvg.replaceWith(svg);
    } else {
      element.innerHTML = "";
      element.appendChild(svg);
    }
  } else if (looksLikeImageUrl(value)) {
    const img = element.querySelector("img") ?? documentOf(element).createElement("img");
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
