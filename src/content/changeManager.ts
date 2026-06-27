import { buildDomPath, buildElementLocator, buildSelector, labelElement, textSnippet } from "./domLocator";
import { editableTextValue } from "./editableText";
import { snapshotElementHtml } from "./domMutations";
import { truncateText } from "./utils";
import type { StyleChange } from "./types";

export function createStyleChange(element: HTMLElement, editableProps: readonly string[]): StyleChange {
  const computed = getComputedStyle(element);
  const before: Record<string, string> = {};
  editableProps.forEach((prop) => {
    before[prop] = computed.getPropertyValue(prop);
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

export function applyStyleChange(change: StyleChange, element: HTMLElement, prop: string, value: string): void {
  element.style.setProperty(prop, value);
  change.after[prop] = value;
  change.updatedAt = Date.now();
}

export function ensureDomChangeBaseline(change: StyleChange, element: HTMLElement, action: string): void {
  if (change.domBefore === undefined) {
    change.domBefore = snapshotElementHtml(element, false);
  }
  change.domAction = action;
}

export function recordDomAfter(change: StyleChange, element: HTMLElement): void {
  change.domAfter = snapshotElementHtml(element, true);
  change.textSnippet = textSnippet(element);
  change.updatedAt = Date.now();
}

export function ensureTextChangeBaseline(change: StyleChange, element: HTMLElement): void {
  if (change.textBefore === undefined) {
    change.textBefore = editableTextValue(element);
  }
  if (change.htmlBefore === undefined) {
    change.htmlBefore = element.innerHTML;
  }
}

export function recordTextAfter(change: StyleChange, element: HTMLElement): void {
  change.textAfter = editableTextValue(element);
  change.htmlAfter = element.innerHTML;
  change.textSnippet = truncateText(change.textAfter.replace(/\s+/g, " ").trim(), 140);
  change.updatedAt = Date.now();
}

export function undoStyleChange(change: StyleChange, element: HTMLElement): HTMLElement | null {
  if (change.domBefore !== undefined) {
    element.outerHTML = change.domBefore;
    return resolveRestoredElement(change.selector);
  }
  for (const prop of Object.keys(change.after)) {
    element.style.setProperty(prop, change.before[prop] ?? "");
  }
  if (change.htmlBefore !== undefined) {
    element.innerHTML = change.htmlBefore;
  } else if (change.textBefore !== undefined) {
    element.textContent = change.textBefore;
  }
  return element;
}

function resolveRestoredElement(selector: string): HTMLElement | null {
  try {
    const restored = document.querySelector(selector);
    return restored instanceof HTMLElement ? restored : null;
  } catch {
    return null;
  }
}
