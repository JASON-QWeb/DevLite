import { computedStyle, documentOf, type InspectableElement } from "./domContext";
import { snapshotElementHtml } from "./domMutations";
import { editableTextValue } from "./editableText";
import type { ContentTextKey } from "./i18n";
import type { StyleChange } from "./types";
import type { ElementResolution } from "./elementAddress";

export type VerificationResult = {
  status: "verified" | "waiting" | "failed";
  reason: string;
};

export type VerificationContext = {
  pageLoadId: string;
  mutationVersion: number;
  exportedElement: InspectableElement | null;
  normalizationRoot: (Node & ParentNode) | null;
  t: (key: ContentTextKey) => string;
  resolution?: ElementResolution["status"];
  rootChanged?: boolean;
};

export function verifyStyleChange(change: StyleChange, element: InspectableElement | null, context: VerificationContext): VerificationResult {
  const samePageLoad = !!change.exportedPageLoadId && change.exportedPageLoadId === context.pageLoadId;
  const hasPageMutation =
    typeof change.exportedMutationVersion === "number" ? context.mutationVersion > change.exportedMutationVersion || context.rootChanged === true : false;
  const deletedDom = change.domBefore !== undefined && change.domAfter === "";

  if (context.resolution && !["resolved", "target-missing"].includes(context.resolution)) {
    return { status: "waiting", reason: context.t(context.resolution === "ambiguous" ? "elementAddressAmbiguous" : "elementContextUnavailable") };
  }

  if (!element) {
    if (deletedDom) {
      // Absence also means routing, virtualization or a conditional render; it cannot prove a source deletion.
      return { status: "waiting", reason: context.t("verifyDeletionNeedsConfirmation") };
    }
    return { status: "failed", reason: context.t("verifyMissingElement") };
  }

  const sameExportedElement = !!context.exportedElement && context.exportedElement === element;

  if (samePageLoad && !hasPageMutation && Object.keys(change.after).length === 0) {
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
  element: InspectableElement,
  ignoreMatchingInlineValues: boolean,
  context: VerificationContext
): string[] {
  const entries = Object.entries(change.after).filter(([, value]) => value);
  if (entries.length === 0) return [];

  // Resolve relative units, variables and inherited fonts in the target's actual layout context.
  // All probes are synchronous and the exact inline declaration is restored before paint.
  const original = element.getAttribute("style");
  const syntax = documentOf(element).createElement("span").style;
  const invalid = entries.filter(([property, value]) => { syntax.cssText = ""; syntax.setProperty(property, value); return !syntax.getPropertyValue(property); });
  if (invalid.length) return invalid.map(([property, value]) => `${property} ${context.t("verifyExpected")} ${value}`);
  try {
    element.style.setProperty("transition", "none", "important");
    element.style.setProperty("animation", "none", "important");
    if (ignoreMatchingInlineValues) {
      for (const [property, expected] of entries) {
        syntax.cssText = "";
        syntax.setProperty(property, expected);
        if (syntax.getPropertyValue(property) !== element.style.getPropertyValue(property)) continue;
        const baseline = change.inlineBefore?.[property];
        if (baseline?.value) element.style.setProperty(property, baseline.value, baseline.priority);
        else element.style.removeProperty(property);
      }
    }
    const actualStyle = computedStyle(element);
    const actual = new Map(entries.map(([property]) => [property, actualStyle.getPropertyValue(property).trim()]));
    for (const [property, expected] of entries) element.style.setProperty(property, expected, "important");
    const expectedStyle = computedStyle(element);
    return entries.filter(([property]) => actual.get(property) !== expectedStyle.getPropertyValue(property).trim())
      .map(([property, expected]) => `${property} ${context.t("verifyExpected")} ${expected}`);
  } finally {
    if (original === null) element.removeAttribute("style");
    else element.setAttribute("style", original);
  }
}

function verifyTextValue(change: StyleChange, element: InspectableElement, context: VerificationContext): string[] {
  if (change.textAfter === undefined || change.textAfter === (change.textBefore ?? "")) return [];
  return normalizeText(editableTextValue(element)) === normalizeText(change.textAfter) ? [] : [context.t("verifyTextMismatch")];
}

function verifyDomValue(change: StyleChange, element: InspectableElement, context: VerificationContext): string[] {
  if (change.domAfter === undefined || change.domAfter === (change.domBefore ?? "")) return [];
  const current = snapshotElementHtml(element, true);
  return normalizeHtml(current) === normalizeHtml(change.domAfter) ? [] : [context.t("verifyDomMismatch")];
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeHtml(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
