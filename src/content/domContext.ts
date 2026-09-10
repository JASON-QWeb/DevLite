export type InspectableElement = HTMLElement | SVGElement;
export type DomRoot = Document | ShadowRoot;

export function isElement(value: unknown): value is Element {
  return !!value && typeof value === "object" && (value as Node).nodeType === 1 && typeof (value as Element).getAttribute === "function";
}

export function isInspectableElement(value: unknown): value is InspectableElement {
  return isElement(value) && "style" in value &&
    (value.namespaceURI === "http://www.w3.org/1999/xhtml" || value.namespaceURI === "http://www.w3.org/2000/svg");
}

export function isHtmlElement(value: unknown): value is HTMLElement {
  return isElement(value) && value.namespaceURI === "http://www.w3.org/1999/xhtml";
}

export function isShadowRoot(value: Node): value is ShadowRoot {
  return value.nodeType === 11 && "host" in value;
}

export function shadowRootOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  try {
    return (typeof chrome !== "undefined" ? chrome.dom?.openOrClosedShadowRoot(element as HTMLElement) : null) as ShadowRoot | null;
  } catch {
    return null;
  }
}

export function rootOf(element: Node): DomRoot {
  const root = element.getRootNode();
  return root.nodeType === 9 || isShadowRoot(root) ? root as DomRoot : element.ownerDocument!;
}

export function documentOf(element: Node): Document {
  const root = rootOf(element);
  return root.nodeType === 9 ? root as Document : root.ownerDocument!;
}

export function windowOf(element: Node): Window {
  return documentOf(element).defaultView ?? window;
}

export function computedStyle(element: Element, pseudo?: string): CSSStyleDeclaration {
  return windowOf(element).getComputedStyle(element, pseudo);
}

/** getBoundingClientRect uses viewport CSS pixels; overlay coordinates must use the same scale. */
export function normalizeOverlayZoom(overlay: HTMLElement): void {
  const parent = overlay.parentElement;
  let zoom = (parent as (Element & { currentCSSZoom?: number }) | null)?.currentCSSZoom;
  if (typeof zoom !== "number") {
    zoom = 1;
    for (let node: Element | null = parent; node; node = composedParent(node)) zoom *= Number.parseFloat(computedStyle(node).getPropertyValue("zoom")) || 1;
  }
  const value = String(1 / (zoom || 1));
  if (overlay.style.zoom !== value) overlay.style.zoom = value;
}

export function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return isShadowRoot(root) ? root.host : null;
}

export function isDevLiteNode(node: unknown): boolean {
  if (!node || typeof node !== "object" || !("nodeType" in node)) return false;
  let element = isElement(node) ? node : (node as Node).parentElement;
  if (!element && isShadowRoot(node as Node)) element = (node as ShadowRoot).host;
  while (element) {
    if (element.id === "devlite-overlay-root" || element.hasAttribute("data-devlite-owned")) return true;
    element = composedParent(element);
  }
  return false;
}

export function elementText(element: Element): string {
  return (isHtmlElement(element) ? element.innerText : "") || element.textContent || "";
}

export function canReplaceImage(element: Element): boolean {
  return isHtmlElement(element) || element.localName === "image";
}

export function canReplaceIcon(element: Element): boolean {
  return isHtmlElement(element) || element.localName === "svg";
}

export function resolveEventElement(event: Event): InspectableElement | null {
  const path = event.composedPath();
  if (path.some(isDevLiteNode)) return null;
  let target = path.find(isInspectableElement) ?? (isInspectableElement(event.target) ? event.target : null);
  if (!target) return null;
  // The outer event path deliberately hides closed roots. Hit-test each accessible root.
  if ("clientX" in event && "clientY" in event) {
    const { clientX, clientY } = event as MouseEvent;
    const visited = new Set<Element>();
    while (!visited.has(target)) {
      visited.add(target);
      const root = shadowRootOf(target);
      const next = root?.elementFromPoint(clientX, clientY);
      if (!isInspectableElement(next) || next === target || isDevLiteNode(next)) break;
      target = next;
    }
  }
  return target;
}
