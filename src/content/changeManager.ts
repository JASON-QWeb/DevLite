import { computedStyle, isInspectableElement, isShadowRoot, type InspectableElement } from "./domContext";
import { buildDomPath, buildElementLocator, buildSelector, labelElement, textSnippet } from "./domLocator";
import { editableTextValue } from "./editableText";
import { snapshotElementHtml } from "./domMutations";
import { truncateText } from "./utils";
import type { StyleChange } from "./types";
import { buildElementAddress, fingerprint, matchesFingerprint, resolveElementAddress, resolveLegacySelector } from "./elementAddress";
import type { ElementFingerprint } from "../shared/types";

type DomSnapshot = { node: Node; attributes?: Array<{ name: string; localName: string; namespace: string | null; value: string }>; value: string | null; children: DomSnapshot[] };
const domSnapshots = new Map<string, { tree: DomSnapshot; related: DomSnapshot[]; parent: Node & ParentNode; parentIdentity?: ElementFingerprint; next: Node | null }>();

function snapshot(node: Node): DomSnapshot {
  return {
    node,
    attributes: isInspectableElement(node) ? Array.from(node.attributes, (attr) => ({ name: attr.name, localName: attr.localName, namespace: attr.namespaceURI, value: attr.value })) : undefined,
    value: node.nodeValue,
    children: Array.from(node.childNodes, snapshot)
  };
}

function restore(snapshot: DomSnapshot): void {
  const { node } = snapshot;
  if (snapshot.attributes && isInspectableElement(node)) {
    for (const attr of Array.from(node.attributes)) if (!snapshot.attributes.some((saved) => saved.localName === attr.localName && saved.namespace === attr.namespaceURI)) node.removeAttributeNS(attr.namespaceURI, attr.localName);
    for (const attr of snapshot.attributes) if (node.getAttributeNS(attr.namespace, attr.localName) !== attr.value) node.setAttributeNS(attr.namespace, attr.name, attr.value);
  }
  if (node.nodeType === 3) node.nodeValue = snapshot.value;
  for (const child of Array.from(node.childNodes)) {
    if (!snapshot.children.some((entry) => entry.node === child)) child.remove();
  }
  for (const [index, child] of snapshot.children.entries()) {
    if (node.childNodes[index] !== child.node) node.insertBefore(child.node, node.childNodes[index] ?? null);
    restore(child);
  }
}

function rememberSnapshot(change: StyleChange, element: InspectableElement): void {
  if (!domSnapshots.has(change.id) && element.parentNode) {
    const parentElement = isShadowRoot(element.parentNode) ? element.parentNode.host : element.parentElement;
    domSnapshots.set(change.id, { tree: snapshot(element), related: [], parent: element.parentNode, parentIdentity: parentElement ? fingerprint(parentElement) : undefined, next: element.nextSibling });
    change.liveDomBaseline = true;
  }
}

export function rememberRelatedDomBaseline(change: StyleChange, element: InspectableElement): void {
  const saved = domSnapshots.get(change.id);
  if (saved && !saved.tree.node.contains(element) && !saved.related.some((entry) => entry.node === element)) saved.related.push(snapshot(element));
}

export function createStyleChange(element: InspectableElement, editableProps: readonly string[]): StyleChange {
  const computed = computedStyle(element);
  const before: Record<string, string> = {};
  const inlineBefore: NonNullable<StyleChange["inlineBefore"]> = {};
  editableProps.forEach((prop) => {
    before[prop] = computed.getPropertyValue(prop);
    inlineBefore[prop] = { value: element.style.getPropertyValue(prop), priority: element.style.getPropertyPriority(prop) };
  });
  const selector = buildSelector(element);
  const domPath = buildDomPath(element);
  return {
    id: `style-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    selector,
    elementLabel: labelElement(element),
    textSnippet: textSnippet(element),
    domPath,
    locator: buildElementLocator(element, selector, domPath),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    before,
    inlineBefore,
    address: buildElementAddress(element),
    after: {},
    updatedAt: Date.now()
  };
}

export function getStyleChangeRecords(sessionChanges: StyleChange[] | undefined, currentChange: StyleChange | null): StyleChange[] {
  const records = new Map<string, StyleChange>();
  for (const change of sessionChanges ?? []) {
    if (hasRecordedChange(change)) {
      records.set(change.id, change);
    }
  }
  if (currentChange && hasRecordedChange(currentChange)) {
    records.set(currentChange.id, currentChange);
  }
  return Array.from(records.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPromptableStyleChangeRecords(sessionChanges: StyleChange[] | undefined, currentChange: StyleChange | null): StyleChange[] {
  return getStyleChangeRecords(sessionChanges, currentChange).filter((change) => !change.exportedAt);
}

export function getVerifyingStyleChangeRecords(sessionChanges: StyleChange[] | undefined, currentChange: StyleChange | null): StyleChange[] {
  return getStyleChangeRecords(sessionChanges, currentChange).filter((change) => !!change.exportedAt);
}

export function hasRecordedChange(change: StyleChange): boolean {
  return (
    Object.keys(change.after).length > 0 ||
    change.textAfter !== undefined ||
    change.htmlAfter !== undefined ||
    change.domAfter !== undefined ||
    Boolean(change.requirement?.text.trim())
  );
}

export function applyStyleChange(change: StyleChange, element: InspectableElement, prop: string, value: string): void {
  change.inlineBefore ??= {};
  change.inlineBefore[prop] ??= { value: element.style.getPropertyValue(prop), priority: element.style.getPropertyPriority(prop) };
  element.style.setProperty(prop, value, element.style.getPropertyPriority(prop));
  change.after[prop] = value;
  change.updatedAt = Date.now();
}

export function ensureDomChangeBaseline(change: StyleChange, element: InspectableElement, action: string): void {
  if (change.domBefore === undefined) {
    change.domBefore = snapshotElementHtml(element, false);
  }
  rememberSnapshot(change, element);
  change.domAction = action;
}

export function recordDomAfter(change: StyleChange, element: InspectableElement): void {
  change.domAfter = snapshotElementHtml(element, true);
  if (change.address) change.address.fingerprint = fingerprint(element);
  change.textSnippet = textSnippet(element);
  change.updatedAt = Date.now();
}

export function ensureTextChangeBaseline(change: StyleChange, element: InspectableElement): void {
  rememberSnapshot(change, element);
  if (change.textBefore === undefined) {
    change.textBefore = editableTextValue(element);
  }
  if (change.htmlBefore === undefined) {
    change.htmlBefore = element.innerHTML;
  }
}

export function recordTextAfter(change: StyleChange, element: InspectableElement): void {
  change.textAfter = editableTextValue(element);
  change.htmlAfter = element.innerHTML;
  change.textSnippet = truncateText(change.textAfter.replace(/\s+/g, " ").trim(), 140);
  change.updatedAt = Date.now();
}

export function undoStyleChange(change: StyleChange, element: InspectableElement): InspectableElement | null {
  const saved = domSnapshots.get(change.id);
  if (change.domBefore !== undefined || change.htmlBefore !== undefined) {
    if (saved) {
      if (saved.tree.node !== element) return null;
      restore(saved.tree);
      for (const related of saved.related) if (related.node.isConnected) restore(related);
    } else {
      // Legacy records can restore static markup. New records require their live baseline.
      if (change.liveDomBaseline) return null;
      if (change.domBefore === undefined) {
        element.innerHTML = change.htmlBefore!;
      } else {
        const root = element.getRootNode() as ParentNode;
        element.outerHTML = change.domBefore;
        const restored = root.querySelector(change.selector);
        return isInspectableElement(restored) ? restored : null;
      }
    }
  }
  for (const prop of Object.keys(change.after)) {
    const original = change.inlineBefore?.[prop];
    if (original) {
      if (original.value) element.style.setProperty(prop, original.value, original.priority);
      else element.style.removeProperty(prop);
    } else element.style.setProperty(prop, change.before[prop] ?? "");
  }
  if (change.htmlBefore !== undefined && !saved) {
    element.innerHTML = change.htmlBefore;
  } else if (change.textBefore !== undefined && change.htmlBefore === undefined && !saved) {
    element.textContent = change.textBefore;
  }
  domSnapshots.delete(change.id);
  return element;
}

export function restoreDeletedChange(change: StyleChange): InspectableElement | null {
  if (change.domAfter !== "") return null;
  const saved = domSnapshots.get(change.id);
  if (!saved || !saved.parent.isConnected || saved.tree.node.isConnected) return null;
  const parentElement = isShadowRoot(saved.parent) ? saved.parent.host : isInspectableElement(saved.parent) ? saved.parent : null;
  if (saved.parentIdentity && (!parentElement || !matchesFingerprint(parentElement, saved.parentIdentity))) return null;
  const element = saved.tree.node;
  saved.parent.insertBefore(element, saved.next?.parentNode === saved.parent ? saved.next : null);
  return isInspectableElement(element) ? undoStyleChange(change, element) : null;
}

export function resolveChangeElement(change: StyleChange, doc: Document = document) {
  return change.address ? resolveElementAddress(change.address, doc, change.textAfter) : resolveLegacySelector(change.selector, doc);
}

export function forgetDomSnapshot(id: string): void {
  domSnapshots.delete(id);
}
