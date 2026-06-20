import { snapshotElementHtml } from "./domMutations";
import { editableTextValue } from "./editableText";
import type { ContentTextKey } from "./i18n";
import type { StyleChange } from "./types";

export type VerificationResult = {
  status: "verified" | "waiting" | "failed";
  reason: string;
};

export type VerificationContext = {
  pageLoadId: string;
  mutationVersion: number;
  exportedElement: HTMLElement | null;
  normalizationRoot: (Node & ParentNode) | null;
  t: (key: ContentTextKey) => string;
};

type InlineSnapshot = Array<{ property: string; value: string; priority: string }>;
type CssProbeRoot = Node & ParentNode;

const cssNormalizationProbes = new WeakMap<CssProbeRoot, HTMLElement>();

export function verifyStyleChange(change: StyleChange, element: HTMLElement | null, context: VerificationContext): VerificationResult {
  if (!element) {
    return { status: "failed", reason: context.t("verifyMissingElement") };
  }

  const samePageLoad = !!change.exportedPageLoadId && change.exportedPageLoadId === context.pageLoadId;
  const hasPageMutation =
    typeof change.exportedMutationVersion === "number" ? context.mutationVersion > change.exportedMutationVersion : false;
  const sameExportedElement = !!context.exportedElement && context.exportedElement === element;

  if (samePageLoad && !hasPageMutation) {
    return { status: "waiting", reason: context.t("waitingForPageUpdate") };
  }

  const textChanged = change.textAfter !== undefined && change.textAfter !== (change.textBefore ?? "");
  const domChanged = change.domAfter !== undefined && change.domAfter !== (change.domBefore ?? "");
  if (samePageLoad && sameExportedElement && (textChanged || domChanged)) {
    return { status: "waiting", reason: context.t("verifySameNodeWaiting") };
  }

  const mismatches = [
    ...verifyStyleValues(change, element, samePageLoad, context),
    ...verifyTextValue(change, element, context),
    ...verifyDomValue(change, element, context)
  ];

  if (mismatches.length > 0) {
    return {
      status: "failed",
      reason: `${context.t("verifyMismatchPrefix")}${context.t("verifyMismatchSeparator")}${mismatches
        .slice(0, 3)
        .join(context.t("verifyMismatchJoiner"))}`
    };
  }

  return { status: "verified", reason: samePageLoad ? context.t("verifyHotUpdateMatched") : context.t("verifyReloadMatched") };
}

function verifyStyleValues(
  change: StyleChange,
  element: HTMLElement,
  ignoreMatchingInlineValues: boolean,
  context: VerificationContext
): string[] {
  const entries = Object.entries(change.after).filter(([, value]) => value);
  if (entries.length === 0) return [];

  const removedInline = ignoreMatchingInlineValues ? removeMatchingInlineValues(element, entries, context.normalizationRoot) : [];
  try {
    const computed = getComputedStyle(element);
    return entries
      .filter(([property, expected]) => !cssValueEquals(property, computed.getPropertyValue(property), expected, context.normalizationRoot))
      .map(([property, expected]) => `${property} ${context.t("verifyExpected")} ${expected}`);
  } finally {
    restoreInlineValues(element, removedInline);
  }
}

function verifyTextValue(change: StyleChange, element: HTMLElement, context: VerificationContext): string[] {
  if (change.textAfter === undefined || change.textAfter === (change.textBefore ?? "")) return [];
  return normalizeText(editableTextValue(element)) === normalizeText(change.textAfter) ? [] : [context.t("verifyTextMismatch")];
}

function verifyDomValue(change: StyleChange, element: HTMLElement, context: VerificationContext): string[] {
  if (change.domAfter === undefined || change.domAfter === (change.domBefore ?? "")) return [];
  const current = snapshotElementHtml(element, true);
  return normalizeHtml(current) === normalizeHtml(change.domAfter) ? [] : [context.t("verifyDomMismatch")];
}

function removeMatchingInlineValues(
  element: HTMLElement,
  entries: Array<[string, string]>,
  normalizationRoot: CssProbeRoot | null
): InlineSnapshot {
  const removed: InlineSnapshot = [];
  for (const [property, expected] of entries) {
    const inlineValue = element.style.getPropertyValue(property);
    if (!inlineValue || !cssValueEquals(property, inlineValue, expected, normalizationRoot)) continue;
    removed.push({
      property,
      value: inlineValue,
      priority: element.style.getPropertyPriority(property)
    });
    element.style.removeProperty(property);
  }
  return removed;
}

function restoreInlineValues(element: HTMLElement, snapshot: InlineSnapshot): void {
  for (const item of snapshot) {
    element.style.setProperty(item.property, item.value, item.priority);
  }
}

function cssValueEquals(property: string, actual: string, expected: string, normalizationRoot: CssProbeRoot | null): boolean {
  return normalizeCssValue(property, actual, normalizationRoot) === normalizeCssValue(property, expected, normalizationRoot);
}

function normalizeCssValue(property: string, value: string, normalizationRoot: CssProbeRoot | null): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const probe = cssNormalizationProbe(normalizationRoot);
  probe.style.cssText =
    "position:absolute;left:-10000px;top:-10000px;width:auto;height:auto;visibility:hidden;pointer-events:none;contain:style layout size;";
  probe.style.setProperty(property, trimmed);
  const normalized = getComputedStyle(probe).getPropertyValue(property).trim() || probe.style.getPropertyValue(property).trim();
  return (normalized || trimmed).replace(/\s+/g, " ").toLowerCase();
}

function cssNormalizationProbe(root: CssProbeRoot | null): HTMLElement {
  const targetRoot = root ?? document.documentElement;
  const existing = cssNormalizationProbes.get(targetRoot);
  if (existing?.isConnected) return existing;

  const probe = existing ?? document.createElement("div");
  probe.setAttribute("data-devlite-css-normalizer", "");
  targetRoot.appendChild(probe);
  cssNormalizationProbes.set(targetRoot, probe);
  return probe;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHtml(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
