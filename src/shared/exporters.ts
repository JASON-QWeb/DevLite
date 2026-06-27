import { generateMarkdownReport } from "./report";
import { promptableStyleChanges } from "./styleChanges";
import { truncateInlineImages } from "./textUtils";
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
  return generateRepairPromptForChanges(promptableStyleChanges(session.styleChanges), locale, session.page);
}

export function generateRepairPromptForChanges(
  styleChanges: DiagnosticSession["styleChanges"],
  locale: UiLocale = "zh",
  page?: DiagnosticSession["page"]
): string {
  return JSON.stringify(
    {
      task:
        locale === "en"
          ? "Modify the page in the current local development project that matches the current page URL, usually a localhost or 127.0.0.1 dev server. Locate target components, assets, copy, and styles with selectors, DOM paths, text snippets, attributes, matched CSS rules, and any user requirement descriptions. Preserve the existing tech stack and code style."
          : "请修改当前本地开发项目中匹配当前页面 URL 的页面，通常是 localhost 或 127.0.0.1 启动的本地开发服务器。根据 selector、DOM 路径、文本片段、属性、命中的 CSS 规则以及用户填写的描述需求内容定位目标组件、资源、文案和样式文件，并保持现有技术栈和代码风格。",
      workflow:
        locale === "en"
          ? {
              primaryUseCase: "DevLite is designed for iterative editing on pages served by a local development server.",
              implementationRule: "Do not treat DOM selectors as the final implementation. Use them only to find the real source files in the local project, then update components, styles, assets, and behavior according to the recorded edits and requirement descriptions."
            }
          : {
              primaryUseCase: "DevLite 面向本地开发服务器上的页面迭代编辑，例如 localhost、127.0.0.1 或团队本地预览服务。",
              implementationRule: "不要把 DOM selector 当成最终实现方案。请仅用这些定位信息在本地项目中找到真实源码文件，再按记录的修改和描述需求内容调整组件、样式、资源与行为。"
            },
      page: page
        ? {
            url: page.url,
            title: page.title,
            viewport: page.viewport
          }
        : undefined,
      changes: styleChanges.map((change, index) => ({
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
          ...domModification(change),
          ...imageEditModification(change, locale),
          ...requirementModification(change, locale)
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
      htmlBefore: truncateInlineImages(change.htmlBefore ?? "", 1200),
      htmlAfter: truncateInlineImages(change.htmlAfter ?? "", 1200)
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
      before: truncateInlineImages(change.domBefore ?? "", 1200),
      after: truncateInlineImages(change.domAfter, 1200)
    }
  ];
}

function imageEditModification(change: DiagnosticSession["styleChanges"][number], locale: UiLocale): Array<Record<string, unknown>> {
  if (!change.imageEdit) {
    return [];
  }

  const originalResource = imageOriginalResource(change);

  return [
    {
      type: "image",
      property: "cropReplacement",
      action: change.domAction ?? "replace image",
      note:
        locale === "en"
          ? "Inline image data is omitted. This prompt is intended for a local project agent: locate the original page resource or uploaded filename in the project, then implement the replacement from project assets."
          : "已省略 inline 图片数据。这个 Prompt 面向本地项目 Agent：请优先根据原页面资源路径或上传文件名在项目中定位图片资源，再用项目资源完成替换。",
      originalResource,
      uploadedFile: change.imageEdit.source,
      source: change.imageEdit.source,
      crop: change.imageEdit.crop,
      output: change.imageEdit.output,
      assetLookupHints: imageAssetLookupHints(change, originalResource),
      instruction:
        locale === "en"
          ? "First search the local project for originalResource.value and uploadedFile.name. If a matching asset exists, use crop/output metadata as the visual crop intent, then crop or reference the project asset and replace the image source in code. If no matching asset exists, keep the original page resource URL when appropriate or ask the user to add the uploaded file to the project assets; do not invent an unrelated image."
          : "请先在本地项目中搜索 originalResource.value 和 uploadedFile.name。若找到匹配资源，把 crop/output 信息作为视觉裁剪意图参考，再裁剪或引用项目资源，并在源码中替换图片路径。若找不到匹配资源，可在合适时继续使用原页面资源 URL，或提示用户把上传文件加入项目 assets；不要凭空生成无关图片。"
    }
  ];
}

function requirementModification(change: DiagnosticSession["styleChanges"][number], locale: UiLocale): Array<Record<string, string>> {
  const text = change.requirement?.text.trim();
  if (!text) {
    return [];
  }

  return [
    {
      type: "request",
      property: "requirementDescription",
      after: text,
      instruction:
        locale === "en"
          ? "Use this element's target information to locate the related source code, then implement the user's requested design or behavior change in the current project."
          : "请按该元素定位信息在源码中找到相关实现，然后在当前项目中实现用户描述的设计或功能调整。"
    }
  ];
}

function imageOriginalResource(change: DiagnosticSession["styleChanges"][number]): Record<string, unknown> {
  const value = firstPresentString(
    change.locator?.attributes?.src,
    firstSrcsetCandidate(change.locator?.attributes?.srcset),
    change.locator?.attributes?.href,
    change.locator?.attributes?.["xlink:href"],
    extractCssUrl(change.before["background-image"]),
    extractHtmlAttribute(change.domBefore ?? "", "src"),
    extractHtmlAttribute(change.domBefore ?? "", "href")
  );

  return {
    value: value.startsWith("data:image/") ? "[inline image data]" : value,
    kind: imageResourceKind(value)
  };
}

function imageAssetLookupHints(change: DiagnosticSession["styleChanges"][number], originalResource: Record<string, unknown>): string[] {
  const hints = [
    typeof originalResource.value === "string" ? originalResource.value : "",
    fileNameFromPath(typeof originalResource.value === "string" ? originalResource.value : ""),
    change.imageEdit?.source.name ?? "",
    change.locator?.attributes?.alt ?? "",
    change.selector,
    change.domPath
  ];
  return Array.from(new Set(hints.filter(Boolean))).slice(0, 12);
}

function imageResourceKind(value: string): string {
  if (!value) return "unknown";
  if (value.startsWith("data:image/")) return "inline-data-redacted";
  if (/^https?:\/\//i.test(value)) return "remote-url";
  if (/^(\/|\.\/|\.\.\/|@\/|~\/)/.test(value)) return "project-or-page-path";
  return "relative-or-attribute";
}

function firstPresentString(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function firstSrcsetCandidate(value?: string): string | undefined {
  return value?.split(",")[0]?.trim().split(/\s+/)[0];
}

function extractCssUrl(value?: string): string | undefined {
  const match = value?.match(/url\((["']?)(.*?)\1\)/i);
  return match?.[2];
}

function extractHtmlAttribute(html: string, attr: string): string | undefined {
  const unquotedAttrValue = "([^\\s\"'=<>`]+)";
  const match = html.match(new RegExp(`\\s${escapeRegExp(attr)}\\s*=\\s*(?:(["'])(.*?)\\1|${unquotedAttrValue})`, "i"));
  return match?.[2] ?? match?.[3];
}

function fileNameFromPath(value: string): string {
  if (!value || value === "[inline image data]") return "";
  try {
    const parsed = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
    return parsed.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return value.split("/").filter(Boolean).pop() ?? "";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
