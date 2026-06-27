import { copyText } from "./clipboard";
import { editableTextValue } from "./editableText";
import { buildAllErrorsText, buildCurlCommand, buildNetworkDetailText, buildNetworkEventText } from "./exportText";
import type { ContentTextKey } from "./i18n";
import { DEFAULT_PANEL_SETTINGS } from "./panelConfig";
import { collectPanelSettingsForm } from "./settings";
import { SKILL_INSTALL_PROMPT } from "./skillInstall";
import { cssBlock } from "./utils";
import type { LiveDiagnosticEvent, NetworkDetailTab, PanelSettings, StyleChange } from "./types";

type PanelActionContext = {
  applyStyle: (prop: string, value: string) => void;
  buildPerformancePrompt: () => string;
  closePanel: () => void;
  ensureCapture: () => Promise<void>;
  ensureResponseBodyCapture: (showToast?: boolean) => Promise<void>;
  eventTypeLabel: (event: LiveDiagnosticEvent) => string;
  getCurrentChange: () => StyleChange | null;
  getPanel: () => ParentNode | null;
  getPendingStyleSync: () => Promise<any> | null;
  getProblemEvents: () => LiveDiagnosticEvent[];
  getNetworkDetailTab: () => NetworkDetailTab;
  getSelectedNetworkEvent: () => LiveDiagnosticEvent | null;
  getSelectedElement: () => HTMLElement | null;
  getSettings: () => Required<PanelSettings>;
  renderPanel: () => void;
  savePanelSettings: (next: PanelSettings, successMessage?: string) => Promise<void>;
  sendRuntime: (message: any) => Promise<any>;
  showSkillInstall: () => void;
  showSettings: () => void;
  startInlineTextEdit: () => void;
  startInspector: () => void;
  stopInlineTextEdit: () => void;
  stopInspector: () => void;
  t: (key: ContentTextKey) => string;
  toast: (message: string) => void;
  toggleLocale: () => Promise<void>;
  undoCurrentChange: () => Promise<void>;
};

export async function handlePanelAction(action: string, context: PanelActionContext): Promise<void> {
  const { t, toast } = context;
  if (action === "close") {
    context.closePanel();
    return;
  }

  if (action === "quick-select") {
    await context.ensureCapture();
    context.startInspector();
    toast(t("clickToSelect"));
    return;
  }

  if (action === "continue-select") {
    await context.ensureCapture();
    context.startInspector();
    toast(t("continueSelect"));
    return;
  }

  if (action === "stop-select") {
    context.stopInspector();
    toast(t("selectionStopped"));
    return;
  }

  if (action === "show-settings") {
    context.showSettings();
    return;
  }

  if (action === "show-skill-install") {
    context.showSkillInstall();
    await copyText(SKILL_INSTALL_PROMPT);
    toast(t("skillPromptCopied"));
    return;
  }

  if (action === "copy-skill-install-prompt") {
    await copyText(SKILL_INSTALL_PROMPT);
    toast(t("skillPromptCopied"));
    return;
  }

  if (action === "save-panel-settings") {
    await context.savePanelSettings(collectPanelSettingsForm(context.getPanel(), context.getSettings()));
    return;
  }

  if (action === "reset-panel-settings") {
    await context.savePanelSettings(DEFAULT_PANEL_SETTINGS, t("settingsReset"));
    return;
  }

  if (action === "toggle-locale") {
    await context.toggleLocale();
    return;
  }

  if (action === "open-source-page") {
    const response = await context.sendRuntime({ type: "open-source-page" });
    if (!response?.ok) toast(response?.error || t("openSourceFailed"));
    return;
  }

  const currentChange = context.getCurrentChange();
  const selectedElement = context.getSelectedElement();

  if (action === "copy-selector" && currentChange) {
    await copyText(currentChange.selector);
    toast(t("selectorCopied"));
    return;
  }

  if (action === "copy-text" && selectedElement) {
    await copyText(editableTextValue(selectedElement));
    toast(t("textCopied"));
    return;
  }

  if (action === "inline-text-edit") {
    context.startInlineTextEdit();
    return;
  }

  if (action === "copy-css" && currentChange) {
    await copyText(cssBlock(currentChange.after, t("noCssEdits")));
    toast(t("cssCopied"));
    return;
  }

  if (action === "copy-prompt") {
    const pendingSync = context.getPendingStyleSync();
    if (pendingSync) {
      await pendingSync.catch(() => null);
    }
    const response = await context.sendRuntime({ type: "generate-export", format: "prompt" });
    if (response?.ok && response.text) {
      await copyText(response.text);
      toast(t("fullPromptCopied"));
    } else {
      toast(response?.error || t("exportFailed"));
    }
    return;
  }

  if (action === "copy-performance-prompt") {
    await copyText(context.buildPerformancePrompt());
    toast(t("performancePromptCopied"));
    return;
  }

  if (action === "copy-selected-network") {
    const selectedNetworkEvent = context.getSelectedNetworkEvent();
    if (!selectedNetworkEvent) {
      toast(t("noRequestToCopy"));
      return;
    }
    await copyText(buildNetworkEventText(selectedNetworkEvent));
    toast(t("requestCopied"));
    return;
  }

  if (action === "copy-selected-network-detail") {
    const selectedNetworkEvent = context.getSelectedNetworkEvent();
    if (!selectedNetworkEvent) {
      toast(t("noRequestToCopy"));
      return;
    }
    await copyText(buildNetworkDetailText(selectedNetworkEvent, context.getNetworkDetailTab()));
    toast(t("networkDetailCopied"));
    return;
  }

  if (action === "copy-selected-curl") {
    const selectedNetworkEvent = context.getSelectedNetworkEvent();
    if (!selectedNetworkEvent) {
      toast(t("noRequestToCopy"));
      return;
    }
    await copyText(buildCurlCommand(selectedNetworkEvent));
    toast(t("curlCopied"));
    return;
  }

  if (action === "copy-all-errors") {
    const text = buildAllErrorsText(context.getProblemEvents(), context.eventTypeLabel);
    if (!text) {
      toast(t("noErrorsToCopy"));
      return;
    }
    await copyText(text);
    toast(t("errorsCopied"));
    return;
  }

  if (action === "download-markdown-report") {
    await downloadReport("markdown", context);
    return;
  }

  if (action === "download-json-report") {
    await downloadReport("json", context);
    return;
  }

  if (action === "enable-response-body") {
    await context.ensureResponseBodyCapture(true);
    return;
  }

  if (action === "hide") {
    context.stopInlineTextEdit();
    context.applyStyle("display", "none");
    context.renderPanel();
    return;
  }

  if (action === "undo") {
    context.stopInlineTextEdit();
    await context.undoCurrentChange();
  }
}

async function downloadReport(format: "markdown" | "json", context: PanelActionContext): Promise<void> {
  const response = await context.sendRuntime({ type: "generate-export", format });
  if (!response?.ok || typeof response.text !== "string") {
    context.toast(response?.error || context.t("exportFailed"));
    return;
  }

  const extension = format === "json" ? "json" : "md";
  const mime = format === "json" ? "application/json" : "text/markdown";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadTextFile(response.text, `devlite-report-${timestamp}.${extension}`, mime);
  context.toast(context.t("reportDownloaded"));
}

function downloadTextFile(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
