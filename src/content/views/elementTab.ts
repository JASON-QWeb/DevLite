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
      <div class="toolbar">
        <button data-action="quick-select" class="primary">${inspectorActive ? t("selecting") : t("selectElement")}</button>
        ${inspectorActive ? `<button data-action="stop-select">${t("stopSelecting")}</button>` : ""}
        <button data-action="copy-selected-style-prompt" ${records.length === 0 ? "disabled" : ""}>${t("copySelectedPrompt")}</button>
        <button data-action="copy-prompt" class="primary">${t("copyFullPrompt")}</button>
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
  return `
      <article class="style-record">
        <div class="style-record-head">
          <label class="style-record-select">
            <input type="checkbox" data-style-record-select value="${escapeHtml(change.id)}" checked />
            <strong title="${escapeHtml(change.elementLabel)}">${index + 1}. ${escapeHtml(change.elementLabel)}</strong>
          </label>
          <span>${context.formatTime(change.updatedAt)}</span>
        </div>
        <code class="style-record-selector" title="${escapeHtml(change.selector)}">${escapeHtml(change.selector)}</code>
        <p>${escapeHtml(summarizeStyleChange(change, context))}</p>
        <div class="style-record-actions">
          <button type="button" data-action="copy-record-prompt" data-change-id="${escapeHtml(change.id)}">${context.t("copyRecordPrompt")}</button>
          <button type="button" data-action="undo-style-record" data-change-id="${escapeHtml(change.id)}">${context.t("restoreElement")}</button>
        </div>
      </article>
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
