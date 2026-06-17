import type { ContentTextKey } from "../i18n";
import { LOGO_URL } from "../panelConfig";
import type { OverlayTab, UiLocale } from "../types";
import { panelIcon } from "./icons";

type PanelCounts = {
  changes: number;
  diagnostics: number;
  network: number;
  performance: number;
};

type PanelShellContext = {
  activeTab: OverlayTab;
  captureActive: boolean;
  counts: PanelCounts;
  inspectorActive: boolean;
  tabBody: string;
  uiLocale: UiLocale;
  t: (key: ContentTextKey) => string;
};

export function renderPanelShell(context: PanelShellContext): string {
  const { activeTab, counts, tabBody, t, uiLocale } = context;
  return `
      <div class="panel-shell">
        <aside class="panel-sidebar">
          <div class="panel-brand">
            <img src="${LOGO_URL}" alt="" />
            <div>
              <strong>DevLite</strong>
            </div>
          </div>
          <nav class="panel-nav" aria-label="${t("features")}">
            ${navButton("element", t("edits"), counts.changes, activeTab)}
            ${navButton("diagnostics", t("diagnostics"), counts.diagnostics, activeTab)}
            ${navButton("network", t("data"), counts.network, activeTab)}
            ${navButton("performance", t("performance"), counts.performance, activeTab)}
          </nav>
          <div class="sidebar-spacer"></div>
          <div class="sidebar-tools">
            <button data-action="toggle-locale" class="locale-button" title="Language" aria-label="Language">${uiLocale === "en" ? "中" : "EN"}</button>
            <button data-action="show-settings" class="config-button icon-only ${activeTab === "settings" ? "active" : ""}" title="${t("settings")}" aria-label="${t("settings")}">${panelIcon("settings")}</button>
          </div>
        </aside>
        <section class="panel-main">
          <div class="panel-header">
            <div>
              <strong>${panelTabTitle(activeTab, t)}</strong>
              <span>${panelHeaderMeta(context)}</span>
            </div>
            <button data-action="close" class="icon-button">${t("close")}</button>
          </div>
          <div class="panel-content" data-panel-tab="${activeTab}">
            ${tabBody}
          </div>
        </section>
        <div class="panel-resize-handle" data-panel-resize aria-hidden="true"></div>
      </div>
    `;
}

function panelTabTitle(activeTab: OverlayTab, t: (key: ContentTextKey) => string): string {
  if (activeTab === "element") return t("editLog");
  if (activeTab === "diagnostics") return t("diagnostics");
  if (activeTab === "network") return t("data");
  if (activeTab === "performance") return t("performance");
  return t("settings");
}

function navButton(tab: OverlayTab, label: string, count: number, activeTab: OverlayTab): string {
  return `
      <button type="button" data-tab="${tab}" class="nav-item ${activeTab === tab ? "active" : ""}">
        <span>${label}</span>
        ${count > 0 ? `<strong>${count > 99 ? "99+" : count}</strong>` : ""}
      </button>
    `;
}

function panelHeaderMeta(context: PanelShellContext): string {
  const { activeTab, counts, inspectorActive, t, uiLocale } = context;
  if (activeTab === "element") {
    return counts.changes > 0 ? (uiLocale === "en" ? `${counts.changes} elements` : `${counts.changes} 个元素`) : inspectorActive ? t("clickToSelect") : t("pagePopoverEditing");
  }
  if (activeTab === "diagnostics") {
    return counts.diagnostics > 0 ? (uiLocale === "en" ? `${counts.diagnostics} issues` : `${counts.diagnostics} 条问题`) : t("listeningErrors");
  }
  if (activeTab === "performance") {
    return counts.performance > 0 ? (uiLocale === "en" ? `${counts.performance} performance risks` : `${counts.performance} 个性能风险`) : t("detectingPerformance");
  }
  if (activeTab === "settings") {
    return t("settingsPanelMeta");
  }
  return counts.network > 0 ? (uiLocale === "en" ? `Latest ${Math.min(counts.network, 20)} requests` : `最近 ${Math.min(counts.network, 20)} 条请求`) : t("summarizingNetwork");
}
