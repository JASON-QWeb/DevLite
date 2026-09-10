import { isInspectableElement, isShadowRoot, rootOf, shadowRootOf, type DomRoot, type InspectableElement } from "./domContext";
import type { ElementAddress, ElementFingerprint } from "../shared/types";

const IDENTITY_ATTRIBUTES = ["id", "data-testid", "data-test", "data-cy", "data-id", "data-key", "data-row-key", "name", "aria-label", "role"];

export type ElementResolution =
  | { status: "resolved"; element: InspectableElement; root: DomRoot }
  | { status: "root-unavailable" | "target-missing" | "ambiguous" | "stale-handle"; element: null; root?: DomRoot };

export function fingerprint(element: Element): ElementFingerprint {
  const attributes: Record<string, string> = {};
  for (const name of IDENTITY_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value !== null) attributes[name] = value;
  }
  return {
    tag: element.localName,
    namespace: element.namespaceURI ?? "",
    attributes,
    text: Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim().slice(0, 160)
  };
}

export function matchesFingerprint(element: Element, expected: ElementFingerprint, textAfter?: string): boolean {
  const actual = fingerprint(element);
  if (actual.tag !== expected.tag || actual.namespace !== expected.namespace) return false;
  if (!Object.entries(expected.attributes).every(([name, value]) => element.getAttribute(name) === value)) return false;
  if (expected.text && actual.text !== expected.text && actual.text !== textAfter?.replace(/\s+/g, " ").trim().slice(0, 160)) return false;
  return true;
}

function unique(root: ParentNode, selector: string, element: Element): boolean {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch { return false; }
}

export function localSelector(element: Element): string {
  const root = rootOf(element);
  const tag = CSS.escape(element.localName);
  if (element.id) {
    const selector = `#${CSS.escape(element.id)}`;
    if (unique(root, selector, element)) return selector;
  }
  for (const attribute of IDENTITY_ATTRIBUTES.slice(1)) {
    const value = element.getAttribute(attribute);
    if (value === null) continue;
    const selector = `${tag}[${attribute}="${CSS.escape(value)}"]`;
    if (unique(root, selector, element)) return selector;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    let part = CSS.escape(current.localName);
    const classes = Array.from(current.classList).filter((name) => !/^(hover|focus|active|selected|open|ng-|v-|css-|__)/i.test(name)).slice(0, 2);
    if (classes.length) part += classes.map((name) => `.${CSS.escape(name)}`).join("");
    const siblings = Array.from(current.parentNode?.children ?? []).filter((node) => node.localName === current!.localName);
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    if (unique(root, parts.join(" > "), element)) break;
    current = current.parentElement;
  }
  return parts.join(" > ");
}

export function buildElementAddress(element: Element): ElementAddress {
  const roots: ElementAddress["shadowPath"] = [];
  let root = element.getRootNode();
  while (isShadowRoot(root)) {
    roots.unshift({ selector: localSelector(root.host), fingerprint: fingerprint(root.host) });
    root = root.host.getRootNode();
  }
  return { version: 1, shadowPath: roots, selector: localSelector(element), fingerprint: fingerprint(element) };
}

function candidates(root: ParentNode, selector: string): Element[] {
  try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
}

export function resolveElementAddress(address: ElementAddress, doc: Document = document, textAfter?: string): ElementResolution {
  let root: DomRoot = doc;
  for (const step of address.shadowPath) {
    const hosts = candidates(root, step.selector);
    if (hosts.length > 1) return { status: "ambiguous", element: null, root };
    const host = hosts[0];
    if (!host || !matchesFingerprint(host, step.fingerprint)) return { status: "root-unavailable", element: null, root };
    const shadow = shadowRootOf(host);
    if (!shadow) return { status: "root-unavailable", element: null, root };
    root = shadow;
  }
  const elements = candidates(root, address.selector);
  if (elements.length > 1) return { status: "ambiguous", element: null, root };
  const element = elements[0];
  if (!isInspectableElement(element)) return { status: "target-missing", element: null, root };
  if (!matchesFingerprint(element, address.fingerprint, textAfter)) return { status: "stale-handle", element: null, root };
  return { status: "resolved", element, root };
}

export function resolveLegacySelector(selector: string, doc: Document = document): ElementResolution {
  const elements = candidates(doc, selector);
  if (elements.length > 1) return { status: "ambiguous", element: null, root: doc };
  return isInspectableElement(elements[0]) ? { status: "resolved", element: elements[0], root: doc } : { status: "target-missing", element: null, root: doc };
}
