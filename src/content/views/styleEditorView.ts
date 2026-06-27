import { escapeHtml, normalizeFontWeight, toHexColor } from "../utils";
import type { ContentTextKey } from "../i18n";
import {
  ICON_ASSET_CATEGORIES,
  getLocalIconsForCategory,
  type IconAssetPanelViewState
} from "../iconAssets";
import type { StyleChange } from "../types";

type StyleEditorViewContext = {
  element: HTMLElement;
  change: StyleChange;
  canEditText: boolean;
  requirementOpen: boolean;
  assetPanel: IconAssetPanelViewState;
  t: (key: ContentTextKey) => string;
};

export function renderStyleEditorView({ element, change, canEditText, requirementOpen, assetPanel, t }: StyleEditorViewContext): string {
  const computed = getComputedStyle(element);
  const basicRows = [
    inputRow("color", t("text"), toHexColor(computed.color), t, "color"),
    inputRow("background-color", t("background"), toHexColor(computed.backgroundColor), t, "color"),
    inputRow("font-size", t("fontSize"), computed.fontSize, t),
    selectRow("font-weight", t("fontWeight"), normalizeFontWeight(computed.fontWeight), ["300", "400", "500", "600", "700", "800"], t)
  ].join("");
  const detailRows = [
    inputRow("line-height", t("lineHeight"), computed.lineHeight, t, "text", "styleHelpLineHeight"),
    inputRow("letter-spacing", t("letterSpacing"), computed.letterSpacing, t, "text", "styleHelpLetterSpacing"),
    inputRow("padding", t("padding"), computed.padding, t, "text", "styleHelpPadding"),
    inputRow("margin", t("margin"), computed.margin, t, "text", "styleHelpMargin"),
    inputRow("width", t("width"), computed.width, t, "text", "styleHelpWidth"),
    inputRow("height", t("height"), computed.height, t, "text", "styleHelpHeight"),
    inputRow("border-radius", t("radius"), computed.borderRadius, t, "text", "styleHelpRadius"),
    inputRow("box-shadow", t("shadow"), computed.boxShadow, t, "text", "styleHelpShadow"),
    selectRow("display", t("display"), computed.display, ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"], t, "styleHelpDisplay"),
    inputRow("gap", t("gap"), computed.gap, t, "text", "styleHelpGap"),
    selectRow("justify-content", t("mainAxis"), computed.justifyContent, ["normal", "flex-start", "center", "space-between", "space-around", "flex-end"], t, "styleHelpMainAxis"),
    selectRow("align-items", t("crossAxis"), computed.alignItems, ["normal", "stretch", "flex-start", "center", "flex-end", "baseline"], t, "styleHelpCrossAxis"),
    inputRow("opacity", t("opacity"), computed.opacity, t, "text", "styleHelpOpacity")
  ].join("");

  return `
      <div class="style-editor-layout ${assetPanel.open ? "asset-open" : ""}">
        <div class="style-editor-primary">
          <div class="style-editor-head">
            <strong>${escapeHtml(change.elementLabel)}</strong>
            <div class="style-editor-head-actions">
              <button type="button" data-style-action="select" class="primary">${t("selectAnother")}</button>
              <button type="button" data-style-action="back-panel" class="icon-button">${t("backToPanel")}</button>
            </div>
          </div>
          <div class="rows style-editor-quick-grid">${basicRows}</div>
          <details class="style-editor-details">
            <summary>${t("advancedStyles")}</summary>
            <div class="rows">${detailRows}</div>
          </details>
          <div class="style-editor-actions">
            <button type="button" data-style-action="text" ${canEditText ? "" : "disabled"}>${t("editText")}</button>
            <button type="button" data-style-action="replace-image">${t("replaceImage")}</button>
            <button type="button" data-style-action="replace-icon" class="${assetPanel.open ? "active" : ""}">${t("replaceIcon")}</button>
            <button type="button" data-style-action="delete-element" class="danger-button">${t("deleteElement")}</button>
            <button type="button" data-style-action="describe-requirement">${t("copyElement")}</button>
            <button type="button" data-style-action="undo">${t("undo")}</button>
          </div>
          ${requirementOpen ? renderRequirementEditor(change, t) : ""}
        </div>
        ${assetPanel.open ? renderIconAssetPanel(assetPanel, t) : ""}
      </div>
      <div class="style-editor-resize-handle" data-style-editor-resize aria-hidden="true"></div>
    `;
}

function renderRequirementEditor(change: StyleChange, t: (key: ContentTextKey) => string): string {
  return `
      <div class="requirement-inline">
        <label class="requirement-inline-field">
          <span>${escapeHtml(t("requirementDescription"))}</span>
          <textarea data-requirement-input placeholder="${escapeHtml(t("requirementPlaceholder"))}">${escapeHtml(change.requirement?.text ?? "")}</textarea>
        </label>
        <div class="requirement-inline-actions">
          <button type="button" data-style-action="requirement-cancel">${t("cancel")}</button>
          <button type="button" data-style-action="requirement-copy-later">${t("requirementCopyLater")}</button>
          <button type="button" class="primary" data-style-action="requirement-copy-now">${t("requirementCopyNow")}</button>
        </div>
      </div>
    `;
}

function renderIconAssetPanel(assetPanel: IconAssetPanelViewState, t: (key: ContentTextKey) => string): string {
  const localIcons = getLocalIconsForCategory(assetPanel.activeCategory);
  return `
      <aside class="style-asset-panel" aria-label="${escapeHtml(t("iconAssetPanelTitle"))}">
        <div class="style-asset-head">
          <div>
            <strong>${escapeHtml(t("iconAssetPanelTitle"))}</strong>
          </div>
          <button type="button" class="icon-button" data-style-action="close-icon-assets">${t("close")}</button>
        </div>
        <div class="style-asset-categories" role="tablist" aria-label="${escapeHtml(t("iconAssetCategories"))}">
          ${ICON_ASSET_CATEGORIES.map(
            (category) => `
              <button
                type="button"
                data-style-action="icon-asset-category"
                data-asset-category="${category.id}"
                class="${assetPanel.activeCategory === category.id ? "active" : ""}"
                role="tab"
                aria-selected="${assetPanel.activeCategory === category.id}"
              >${t(category.labelKey)}</button>
            `
          ).join("")}
        </div>
        <section class="style-asset-section">
          <div class="style-asset-section-head">
            <strong>${escapeHtml(t("iconAssetLocal"))}</strong>
          </div>
          <div class="style-asset-grid">
            ${localIcons.map((asset) => iconAssetButton("apply-local-icon", asset.id, asset.label, asset.svg, "data-asset-id")).join("")}
          </div>
        </section>
        <section class="style-asset-section">
          <div class="style-asset-section-head">
            <strong>${escapeHtml(t("iconAssetOnline"))}</strong>
            <div class="style-asset-search-control">
              <input data-icon-asset-search type="search" value="${escapeHtml(assetPanel.searchQuery)}" placeholder="${escapeHtml(t("iconAssetSearchPlaceholder"))}" />
              <button type="button" data-style-action="icon-asset-search" aria-label="${escapeHtml(t("iconAssetSearch"))}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="11" cy="11" r="7"></circle>
                  <path d="m20 20-4-4"></path>
                </svg>
              </button>
            </div>
            ${assetPanel.loading ? `<span>${escapeHtml(t("iconAssetLoading"))}</span>` : ""}
          </div>
          ${renderOnlineIconAssets(assetPanel, t)}
        </section>
        <section class="style-asset-section">
          <label class="style-asset-field">
            <span>${escapeHtml(t("iconAssetManual"))}</span>
            <textarea data-icon-asset-input placeholder="${escapeHtml(t("iconAssetManualPlaceholder"))}"></textarea>
          </label>
          <button type="button" class="primary" data-style-action="apply-manual-icon">${t("useIconAsset")}</button>
        </section>
      </aside>
    `;
}

function renderOnlineIconAssets(assetPanel: IconAssetPanelViewState, t: (key: ContentTextKey) => string): string {
  if (assetPanel.error) {
    return `<div class="style-asset-empty">${escapeHtml(assetPanel.error)}</div>`;
  }
  if (assetPanel.loading && assetPanel.onlineIcons.length === 0) {
    return `<div class="style-asset-empty">${escapeHtml(t("iconAssetLoading"))}</div>`;
  }
  if (!assetPanel.onlineSearched && assetPanel.onlineIcons.length === 0) {
    return "";
  }
  if (assetPanel.onlineIcons.length === 0) {
    return `<div class="style-asset-empty">${escapeHtml(t("iconAssetEmpty"))}</div>`;
  }
  return `
    <div class="style-asset-grid">
      ${assetPanel.onlineIcons.map((asset) => iconAssetButton("apply-online-icon", asset.id, asset.label, asset.svg, "data-icon-id")).join("")}
    </div>
  `;
}

function iconAssetButton(action: string, id: string, label: string, svg: string, dataName: string): string {
  return `
    <button type="button" class="style-asset-icon" data-style-action="${action}" ${dataName}="${escapeHtml(id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
      ${svg}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function inputRow(prop: string, label: string, value: string, t: (key: ContentTextKey) => string, type = "text", helpKey?: ContentTextKey): string {
  const fieldId = styleFieldId(prop);
  return `
      <div class="row style-field">
        ${fieldLabel(fieldId, label)}
        <div class="style-field-control ${helpKey ? "has-help" : ""}">
          <input id="${fieldId}" data-prop="${escapeHtml(prop)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" />
          ${fieldHelp(t, helpKey)}
        </div>
      </div>
    `;
}

function selectRow(prop: string, label: string, value: string, options: string[], t: (key: ContentTextKey) => string, helpKey?: ContentTextKey): string {
  const allOptions = options.includes(value) ? options : [value, ...options];
  const fieldId = styleFieldId(prop);
  return `
      <div class="row style-field">
        ${fieldLabel(fieldId, label)}
        <div class="style-field-control ${helpKey ? "has-help" : ""}">
          <select id="${fieldId}" data-prop="${escapeHtml(prop)}">
            ${allOptions.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(optionLabel(prop, option, t))}</option>`).join("")}
          </select>
          ${fieldHelp(t, helpKey)}
        </div>
      </div>
    `;
}

function fieldLabel(id: string, label: string): string {
  return `
      <div class="style-field-label">
        <label for="${id}">${escapeHtml(label)}</label>
      </div>
    `;
}

function fieldHelp(t: (key: ContentTextKey) => string, helpKey?: ContentTextKey): string {
  const helpText = helpKey ? t(helpKey) : "";
  if (!helpText) return "";
  return `<button type="button" class="style-field-help" aria-label="${escapeHtml(`${t("styleHelpLabel")}: ${helpText}`)}" data-tooltip="${escapeHtml(helpText)}">?</button>`;
}

function styleFieldId(prop: string): string {
  return `devlite-style-${prop.replace(/[^a-z0-9]+/gi, "-")}`;
}

function optionLabel(prop: string, value: string, t: (key: ContentTextKey) => string): string {
  const key = optionLabelKey(prop, value);
  return key ? t(key) : value;
}

function optionLabelKey(prop: string, value: string): ContentTextKey | null {
  if (prop === "display") {
    const displayLabels: Record<string, ContentTextKey> = {
      block: "cssDisplayBlock",
      inline: "cssDisplayInline",
      "inline-block": "cssDisplayInlineBlock",
      flex: "cssDisplayFlex",
      "inline-flex": "cssDisplayInlineFlex",
      grid: "cssDisplayGrid",
      none: "cssDisplayNone"
    };
    return displayLabels[value] ?? null;
  }
  if (prop === "justify-content" || prop === "align-items") {
    const alignmentLabels: Record<string, ContentTextKey> = {
      normal: "cssDefaultNormal",
      stretch: "cssStretch",
      "flex-start": "cssFlexStart",
      center: "cssCenter",
      "space-between": "cssSpaceBetween",
      "space-around": "cssSpaceAround",
      "flex-end": "cssFlexEnd",
      baseline: "cssBaseline"
    };
    return alignmentLabels[value] ?? null;
  }
  return null;
}
