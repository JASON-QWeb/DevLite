import { escapeHtml, normalizeFontWeight, toHexColor } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { StyleChange } from "../types";

type StyleEditorViewContext = {
  element: HTMLElement;
  change: StyleChange;
  canEditText: boolean;
  t: (key: ContentTextKey) => string;
};

export function renderStyleEditorView({ element, change, canEditText, t }: StyleEditorViewContext): string {
  const computed = getComputedStyle(element);
  const basicRows = [
    inputRow("color", t("text"), toHexColor(computed.color), "color"),
    inputRow("background-color", t("background"), toHexColor(computed.backgroundColor), "color"),
    inputRow("font-size", t("fontSize"), computed.fontSize),
    selectRow("font-weight", t("fontWeight"), normalizeFontWeight(computed.fontWeight), ["300", "400", "500", "600", "700", "800"])
  ].join("");
  const detailRows = [
    inputRow("line-height", t("lineHeight"), computed.lineHeight),
    inputRow("letter-spacing", t("letterSpacing"), computed.letterSpacing),
    inputRow("padding", t("padding"), computed.padding),
    inputRow("margin", t("margin"), computed.margin),
    inputRow("width", t("width"), computed.width),
    inputRow("height", t("height"), computed.height),
    inputRow("border-radius", t("radius"), computed.borderRadius),
    inputRow("box-shadow", t("shadow"), computed.boxShadow),
    selectRow("display", t("display"), computed.display, ["block", "inline-block", "flex", "inline-flex", "grid", "none"]),
    inputRow("gap", t("gap"), computed.gap),
    selectRow("justify-content", t("mainAxis"), computed.justifyContent, ["normal", "flex-start", "center", "space-between", "space-around", "flex-end"]),
    selectRow("align-items", t("crossAxis"), computed.alignItems, ["normal", "stretch", "flex-start", "center", "flex-end", "baseline"]),
    inputRow("opacity", t("opacity"), computed.opacity)
  ].join("");

  return `
      <div class="style-editor-head">
        <strong>${escapeHtml(change.elementLabel)}</strong>
        <div class="style-editor-head-actions">
          <button type="button" data-style-action="select" class="primary">${t("selectAnother")}</button>
          <button type="button" data-style-action="back-panel" class="icon-button">${t("backToPanel")}</button>
        </div>
      </div>
      <div class="rows">${basicRows}</div>
      <details class="style-editor-details">
        <summary>${t("more")}</summary>
        <div class="rows">${detailRows}</div>
      </details>
      <div class="style-editor-actions">
        <button type="button" data-style-action="text" ${canEditText ? "" : "disabled"}>${t("editText")}</button>
        <button type="button" data-style-action="replace-image">${t("replaceImage")}</button>
        <button type="button" data-style-action="replace-icon">${t("replaceIcon")}</button>
        <button type="button" data-style-action="delete-element" class="danger-button">${t("deleteElement")}</button>
        <button type="button" data-style-action="copy-element">${t("copyElement")}</button>
        <button type="button" data-style-action="undo">${t("undo")}</button>
      </div>
    `;
}

function inputRow(prop: string, label: string, value: string, type = "text"): string {
  return `
      <label class="row">
        <span>${escapeHtml(label)}</span>
        <input data-prop="${escapeHtml(prop)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" />
      </label>
    `;
}

function selectRow(prop: string, label: string, value: string, options: string[]): string {
  const allOptions = options.includes(value) ? options : [value, ...options];
  return `
      <label class="row">
        <span>${escapeHtml(label)}</span>
        <select data-prop="${escapeHtml(prop)}">
          ${allOptions.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
}
