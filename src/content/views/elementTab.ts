import { escapeHtml } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { StyleChange, UiLocale } from "../types";

type ElementTabContext = {
  records: StyleChange[];
  inspectorActive: boolean;
  locale: UiLocale;
  t: (key: ContentTextKey) => string;
  formatTime: (timestamp: number) => string;
};

export function renderElementTabView(context: ElementTabContext): string {
  const { records, inspectorActive, t } = context;
  return `
      <div class="toolbar element-toolbar">
        <div class="toolbar-group">
          <button data-action="quick-select" class="primary">${inspectorActive ? t("selecting") : t("selectElement")}</button>
          <button data-action="select-all-style-records" ${records.length === 0 ? "disabled" : ""}>${t("selectAll")}</button>
          ${inspectorActive ? `<button data-action="stop-select">${t("stopSelecting")}</button>` : ""}
        </div>
        <div class="toolbar-group toolbar-group-right">
          <button data-action="copy-prompt" class="primary" ${records.length === 0 ? "disabled" : ""}>${t("copyFullPrompt")}</button>
        </div>
      </div>
      ${
        records.length === 0
          ? `<div class="empty">${t("noEditRecords")}</div>`
          : `<div class="style-record-list">${records.map((change, index) => renderStyleChangeRecord(change, index, context)).join("")}</div>`
      }
    `;
}

export function summarizeStyleChange(change: StyleChange, context: Pick<ElementTabContext, "locale" | "t">): string {
  const parts = Object.keys(change.after).map((prop) => stylePropLabel(prop, context.t));
  if (change.textAfter !== undefined || change.htmlAfter !== undefined) {
    parts.unshift(context.t("textContent"));
  }
  if (change.domAfter !== undefined) {
    parts.unshift(change.domAction || context.t("elementDom"));
  }
  return parts.length > 0 ? parts.join(context.locale === "en" ? ", " : "、") : context.t("selectedNoEdits");
}

function renderStyleChangeRecord(change: StyleChange, index: number, context: ElementTabContext): string {
  const tagName = styleRecordTagName(change.elementLabel);
  const title = compactElementTitle(change);
  return `
      <article class="style-record">
        <div class="style-record-head">
          <div class="style-record-title">
            <label class="style-record-select" title="${escapeHtml(change.elementLabel)}">
              <input type="checkbox" data-style-record-select value="${escapeHtml(change.id)}" checked />
              <span class="style-record-index">${index + 1}</span>
              <span class="style-record-icon" aria-label="${escapeHtml(tagName)}">${styleRecordIcon(tagName)}</span>
              <strong>${escapeHtml(title)}</strong>
            </label>
            <button type="button" class="style-record-restore" data-action="undo-style-record" data-change-id="${escapeHtml(change.id)}">${context.t("restoreElement")}</button>
          </div>
          <span class="style-record-time">${context.formatTime(change.updatedAt)}</span>
        </div>
        ${renderSelectorPath(change.selector)}
        <p>${escapeHtml(summarizeStyleChange(change, context))}</p>
      </article>
    `;
}

function styleRecordTagName(label: string): string {
  return label.split(/[.#[:]/)[0] || "element";
}

function compactElementTitle(change: StyleChange): string {
  const tagName = styleRecordTagName(change.elementLabel);
  if (tagName === "input" || tagName === "textarea") return tagName;
  return truncateLabel(compactSelectorSegment(change.elementLabel), 46);
}

function renderSelectorPath(selector: string): string {
  const parts = selector.split(/\s*>\s*/).filter(Boolean);
  const visible = parts.length > 4 ? parts.slice(-4) : parts;
  const prefix = parts.length > visible.length ? `<span class="selector-ellipsis">...</span><span class="selector-separator">/</span>` : "";
  return `
      <div class="style-record-path" title="${escapeHtml(selector)}">
        ${prefix}
        ${visible
          .map((part, index) => {
            const isTarget = index === visible.length - 1;
            return `
              <span class="selector-node ${isTarget ? "target" : ""}">${escapeHtml(compactSelectorSegment(part))}</span>
              ${index < visible.length - 1 ? `<span class="selector-separator">/</span>` : ""}
            `;
          })
          .join("")}
      </div>
    `;
}

function compactSelectorSegment(value: string): string {
  const cleaned = value.replace(/:nth-of-type\((\d+)\)/g, ":$1").trim();
  const tag = cleaned.match(/^[a-z][\w-]*/i)?.[0] ?? "element";
  const id = cleaned.match(/#[\w-]+/)?.[0] ?? "";
  const classes = Array.from(cleaned.matchAll(/\.([\w-]+)/g))
    .map((match) => match[1])
    .filter(Boolean)
    .slice(0, 1)
    .map((className) => `.${truncateClassName(className)}`)
    .join("");
  return `${tag}${id}${classes}`;
}

function truncateClassName(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 21)}...`;
}

function truncateLabel(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function styleRecordIcon(tagName: string): string {
  if (tagName === "input" || tagName === "textarea") {
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="4" y="7" width="16" height="10" rx="2" />
          <path d="M8 12h8" />
        </svg>
      `;
  }
  if (tagName === "img" || tagName === "picture") {
    return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 15l3-3 2 2 3-4 2 5" />
          <circle cx="9" cy="9" r="1.3" />
        </svg>
      `;
  }
  return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 7l-4 5 4 5" />
        <path d="M16 7l4 5-4 5" />
        <path d="M13 5l-2 14" />
      </svg>
    `;
}

function stylePropLabel(prop: string, t: (key: ContentTextKey) => string): string {
  const labels: Record<string, string> = {
    color: t("textColor"),
    "background-color": t("backgroundColor"),
    "font-size": t("fontSize"),
    "font-weight": t("fontWeight"),
    "line-height": t("lineHeight"),
    "letter-spacing": t("letterSpacing"),
    padding: t("padding"),
    margin: t("margin"),
    width: t("width"),
    height: t("height"),
    "border-radius": t("radius"),
    "box-shadow": t("shadow"),
    display: t("display"),
    gap: t("gap"),
    "justify-content": t("mainAxis"),
    "align-items": t("crossAxis"),
    opacity: t("opacity")
  };
  return labels[prop] ?? prop;
}
