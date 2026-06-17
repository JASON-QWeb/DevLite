import { copyText } from "./clipboard";
import { editableTextValue } from "./editableText";
import { buildAllErrorsText, buildNetworkEventText } from "./exportText";
import type { ContentTextKey } from "./i18n";
import { DEFAULT_PANEL_SETTINGS } from "./panelConfig";
import { collectPanelSettingsForm } from "./settings";
import { cssBlock } from "./utils";
import type { LiveDiagnosticEvent, PanelSettings, StyleChange } from "./types";

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
  getSelectedNetworkEvent: () => LiveDiagnosticEvent | null;
  getSelectedElement: () => HTMLElement | null;
  getSettings: () => Required<PanelSettings>;
  renderPanel: () => void;
  savePanelSettings: (next: PanelSettings, successMessage?: string) => Promise<void>;
  sendRuntime: (message: any) => Promise<any>;
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
