import { generateMarkdownReport } from "./report";
import type { DiagnosticSettings, DiagnosticSession, ExportFormat } from "./types";

export function generateExport(session: DiagnosticSession, settings: DiagnosticSettings, format: ExportFormat): string {
  if (format === "json") {
    return JSON.stringify(session, null, 2);
  }

  if (format === "markdown") {
    return generateMarkdownReport(session, settings);
  }

  return generateAiPrompt(session);
}

export function generateAiPrompt(session: DiagnosticSession): string {
  return JSON.stringify(
    {
      changes: session.styleChanges.map((change, index) => ({
        index: index + 1,
        target: {
          label: change.elementLabel,
          tagName: change.locator?.tagName ?? "",
          id: change.locator?.id ?? "",
          classList: change.locator?.classList ?? parseClassList(change.elementLabel),
          attributes: change.locator?.attributes ?? {},
          selector: change.selector,
          domPath: change.domPath,
          openingTag: change.locator?.openingTag ?? "",
          outerHTMLSnippet: change.locator?.outerHTMLSnippet ?? "",
          text: change.textSnippet,
          viewport: change.viewport,
          parentChain: change.locator?.parentChain ?? [],
          searchHints: buildSearchHints(change)
        },
        sourceHints: {
          matchedCssRules: change.locator?.matchedCssRules ?? []
        },
        modifications: [
          ...Object.entries(change.after)
            .filter(([, after]) => after)
            .map(([property, after]) => ({
              type: "style",
              property,
              before: change.before[property] ?? "",
              after
            })),
          ...textModification(change)
        ]
      }))
    },
    null,
    2
  );
}

function parseClassList(label: string): string[] {
  return label.split("#").pop()?.split(".").slice(1).filter(Boolean) ?? [];
}

function buildSearchHints(change: DiagnosticSession["styleChanges"][number]): string[] {
  const locator = change.locator;
  const classList = locator?.classList ?? parseClassList(change.elementLabel);
  const hints = [
    change.selector,
    change.domPath,
    change.elementLabel,
    locator?.id ? `#${locator.id}` : "",
    ...classList.map((className) => `.${className}`),
    ...Object.entries(locator?.attributes ?? {}).map(([key, value]) => `[${key}="${value}"]`),
    ...(locator?.parentChain.map((item) => item.selector) ?? []),
    ...(locator?.matchedCssRules.map((rule) => rule.selectorText) ?? [])
  ];
  return Array.from(new Set(hints.filter(Boolean))).slice(0, 48);
}

function textModification(change: DiagnosticSession["styleChanges"][number]): Array<Record<string, string>> {
  if (change.textAfter === undefined || change.textAfter === (change.textBefore ?? "")) {
    return [];
  }

  return [
    {
      type: "text",
      property: "textContent",
      before: change.textBefore ?? "",
      after: change.textAfter,
      htmlBefore: truncate(change.htmlBefore ?? "", 1200),
      htmlAfter: truncate(change.htmlAfter ?? "", 1200)
    }
  ];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[TRUNCATED ${value.length - max} chars]`;
}
