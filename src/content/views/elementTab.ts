import { escapeHtml } from "../utils";
import type { ContentTextKey } from "../i18n";
import type { ArchivedStyleChange, StyleChange, UiLocale } from "../types";

type ElementTabContext = {
  pendingRecords: StyleChange[];
  verifyingRecords: StyleChange[];
  archivedRecords: ArchivedStyleChange[];
  inspectorActive: boolean;
  locale: UiLocale;
  t: (key: ContentTextKey) => string;
  formatTime: (timestamp: number) => string;
};

export function renderElementTabView(context: ElementTabContext): string {
  const { pendingRecords, verifyingRecords, archivedRecords, inspectorActive, t } = context;
  return `
      <div class="toolbar element-toolbar">
        <div class="toolbar-group">
          <button data-action="quick-select" class="primary">${inspectorActive ? t("selecting") : t("selectElement")}</button>
          <button data-action="verify-style-records" ${verifyingRecords.length === 0 ? "disabled" : ""}>${t("verifyNow")}</button>
          ${inspectorActive ? `<button data-action="stop-select">${t("stopSelecting")}</button>` : ""}
        </div>
        <div class="toolbar-group toolbar-group-right">
          <button data-action="select-all-style-records" ${pendingRecords.length === 0 ? "disabled" : ""}>${t("selectAll")}</button>
          <button data-action="copy-prompt" class="primary" ${pendingRecords.length === 0 ? "disabled" : ""}>${t("copyFullPrompt")}</button>
        </div>
      </div>
      ${renderActiveSection(t("pendingEdits"), pendingRecords, context, "pending")}
      ${renderActiveSection(t("verifyingEdits"), verifyingRecords, context, "verifying")}
      ${renderArchiveSection(archivedRecords, context)}
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
  if (change.requirement?.text.trim()) {
    parts.unshift(context.t("requirementDescription"));
  }
  return parts.length > 0 ? parts.join(context.locale === "en" ? ", " : "、") : context.t("selectedNoEdits");
}

function renderActiveSection(title: string, records: StyleChange[], context: ElementTabContext, mode: "pending" | "verifying"): string {
  return `
    <section class="style-record-section" data-style-record-section="${mode}">
      <div class="style-record-section-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${records.length}</span>
      </div>
      ${
        records.length === 0
          ? `<div class="empty compact">${context.t(mode === "pending" ? "noPendingEdits" : "noVerifyingEdits")}</div>`
          : `<div class="style-record-list">${records.map((change, index) => renderStyleChangeRecord(change, index, context, mode)).join("")}</div>`
      }
    </section>
  `;
}

function renderArchiveSection(records: ArchivedStyleChange[], context: ElementTabContext): string {
  return `
    <section class="style-record-section" data-style-record-section="archive">
      <div class="style-record-section-head">
        <strong>${escapeHtml(context.t("fixedArchive"))}</strong>
        <span>${records.length}</span>
      </div>
      ${
        records.length === 0
          ? `<div class="empty compact">${context.t("noArchivedEdits")}</div>`
          : `<div class="style-record-list">${records
              .slice()
              .sort((a, b) => b.archivedAt - a.archivedAt)
              .map((item, index) => renderArchivedStyleChangeRecord(item, index, context))
              .join("")}</div>`
      }
    </section>
  `;
}

function renderStyleChangeRecord(change: StyleChange, index: number, context: ElementTabContext, mode: "pending" | "verifying"): string {
  const tagName = styleRecordTagName(change.elementLabel);
  const title = compactElementTitle(change);
  return `
      <article class="style-record">
        <div class="style-record-head">
          <div class="style-record-title">
            <label class="style-record-select ${mode === "verifying" ? "readonly" : ""}" title="${escapeHtml(change.elementLabel)}">
              ${mode === "pending" ? `<input type="checkbox" data-style-record-select value="${escapeHtml(change.id)}" checked />` : ""}
              <span class="style-record-index">${index + 1}</span>
              <span class="style-record-icon" aria-label="${escapeHtml(tagName)}">${styleRecordIcon(tagName)}</span>
              <strong>${escapeHtml(title)}</strong>
            </label>
            ${
              mode === "pending"
                ? `<button type="button" class="style-record-restore" data-action="undo-style-record" data-change-id="${escapeHtml(change.id)}">${context.t("restoreElement")}</button>`
                : ""
            }
            ${
              mode === "verifying"
                ? `<button type="button" class="style-record-restore" data-action="requeue-style-record" data-change-id="${escapeHtml(change.id)}">${context.t("retryRepair")}</button>`
                : ""
            }
            ${
              mode === "verifying"
                ? `<button type="button" class="style-record-restore" data-action="archive-style-record" data-change-id="${escapeHtml(change.id)}">${context.t("markFixed")}</button>`
                : ""
            }
          </div>
          <span class="style-record-time">${context.formatTime(change.updatedAt)}</span>
        </div>
        ${renderSelectorPath(change.selector)}
        <p>${escapeHtml(summarizeStyleChange(change, context))}</p>
        ${renderRequirementSummary(change, context)}
        ${mode === "verifying" ? renderVerificationMeta(change, context) : ""}
      </article>
    `;
}

function renderArchivedStyleChangeRecord(item: ArchivedStyleChange, index: number, context: ElementTabContext): string {
  const change = item.change;
  const tagName = styleRecordTagName(change.elementLabel);
  return `
    <article class="style-record archived">
      <div class="style-record-head">
        <div class="style-record-title">
          <span class="style-record-index">${index + 1}</span>
          <span class="style-record-icon" aria-label="${escapeHtml(tagName)}">${styleRecordIcon(tagName)}</span>
          <strong>${escapeHtml(compactElementTitle(change))}</strong>
        </div>
        <span class="style-record-time">${context.formatTime(item.archivedAt)}</span>
      </div>
      ${renderSelectorPath(change.selector)}
      <p>${escapeHtml(summarizeStyleChange(change, context))}</p>
      ${renderRequirementSummary(change, context)}
      <p class="style-record-status">${escapeHtml(archiveReasonLabel(item, context))}</p>
    </article>
  `;
}

function renderRequirementSummary(change: StyleChange, context: Pick<ElementTabContext, "locale" | "t">): string {
  const text = change.requirement?.text.trim();
  if (!text) return "";
  const separator = context.locale === "en" ? ": " : "：";
  return `<p class="style-record-requirement">${escapeHtml(context.t("requirementDescription"))}${separator}${escapeHtml(truncateLabel(text, 160))}</p>`;
}

function renderVerificationMeta(change: StyleChange, context: ElementTabContext): string {
  const status = change.verificationStatus === "failed" ? context.t("verifyFailed") : context.t("verifyWaiting");
  const reason = change.lastVerifyReason || context.t("waitingForPageUpdate");
  return `<p class="style-record-status">${escapeHtml(status)} · ${escapeHtml(reason)}</p>`;
}

function archiveReasonLabel(item: ArchivedStyleChange, context: ElementTabContext): string {
  const reason = item.archiveReason === "manual" ? context.t("archivedManually") : context.t("archivedVerified");
  return item.verificationReason ? `${reason} · ${item.verificationReason}` : reason;
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
