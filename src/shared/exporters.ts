import { generateMarkdownReport } from "./report";
import type { DiagnosticSettings, DiagnosticSession, ExportFormat, UiLocale } from "./types";

export function generateExport(session: DiagnosticSession, settings: DiagnosticSettings, format: ExportFormat): string {
  if (format === "json") {
    return JSON.stringify(session, null, 2);
  }

  if (format === "markdown") {
    return generateMarkdownReport(session, settings);
  }

  return generateRepairPrompt(session, settings.locale);
}

export function generateRepairPrompt(session: DiagnosticSession, locale: UiLocale = "zh"): string {
  return JSON.stringify(
    {
      task:
        locale === "en"
          ? "Implement the following DevLite page edits in the source code. Locate the target components with selectors, DOM paths, text snippets, attributes, and matched CSS rules. Preserve the existing tech stack and code style."
          : "请将以下 DevLite 页面临时修改落实到源码中。根据 selector、DOM 路径、文本片段、属性和命中的 CSS 规则定位目标组件，并保持现有技术栈和代码风格。",
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
          ...textModification(change),
          ...domModification(change)
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

function domModification(change: DiagnosticSession["styleChanges"][number]): Array<Record<string, string>> {
  if (change.domAfter === undefined || change.domAfter === (change.domBefore ?? "")) {
    return [];
  }

  return [
    {
      type: "dom",
      property: change.domAction ?? "outerHTML",
      before: truncate(change.domBefore ?? "", 1200),
      after: truncate(change.domAfter, 1200)
    }
  ];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[TRUNCATED ${value.length - max} chars]`;
}
