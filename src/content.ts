import { copyText } from "./content/clipboard";
import {
  applyStyleChange,
  createStyleChange,
  ensureTextChangeBaseline as ensureTextChangeRecordBaseline,
  getStyleChangeRecords as getRecordedStyleChanges,
  recordTextAfter as recordTextChangeAfter,
  undoStyleChange
} from "./content/changeManager";
import { contentText, type ContentTextKey } from "./content/i18n";
import {
  buildSelector,
  labelElement,
  resolveInspectableTarget,
  textSnippet
} from "./content/domLocator";
import { DiagnosticEventBatcher, DiagnosticEventStore } from "./content/diagnosticEvents";
import { canEditTextContent as canEditTextContentBase } from "./content/editableText";
import { bindImageFileInput } from "./content/imageFileInput";
import { applyIconReplacement, applyImageReplacement } from "./content/imageReplacement";
import { InlineTextEditor } from "./content/inlineTextEditor";
import { LauncherDockController } from "./content/launcherDock";
import { overlayStyles } from "./content/overlayStyles";
import { formatUrl, getPageContext } from "./content/pageContext";
import { handlePanelAction } from "./content/panelActions";
import { bindPanelEvents } from "./content/panelEvents";
import { EDITABLE_PROPS, PANEL_THEMES } from "./content/panelConfig";
import { PanelPositionController } from "./content/panelPosition";
import { PanelRefreshController } from "./content/panelRefresh";
import {
  renderPayloadPanel as renderNetworkPayloadPanel,
  summarizeNetworkData as summarizeNetworkEventData
} from "./content/networkDetails";
import {
  buildPerformancePrompt as buildPerformancePromptText,
  formatResourceTiming as formatPerformanceResourceTiming,
  getPerformanceInsights as getPerformanceInsightsData
} from "./content/performance";
import { PerformanceMonitor } from "./content/performanceMonitor";
import { collectPanelSettingsForm, mergePanelSettings, normalizeLocale, normalizeTheme } from "./content/settings";
import { bindStyleEditorEvents } from "./content/styleEditorEvents";
import { StyleEditorPositionController } from "./content/styleEditorPosition";
import {
  escapeHtml,
  formatTime as formatLocalizedTime,
  randomId
} from "./content/utils";
import { renderDiagnosticsTabView } from "./content/views/diagnosticsTab";
import { renderElementTabView } from "./content/views/elementTab";
import { pickSelectedNetworkEvent, renderNetworkTabView } from "./content/views/networkTab";
import { renderPanelShell } from "./content/views/panelShell";
import { renderPerformanceTabView } from "./content/views/performanceTab";
import { renderSettingsTabView } from "./content/views/settingsTab";
import { renderStyleEditorView } from "./content/views/styleEditorView";
import { CONTROL_CHANNEL, PAGE_CHANNEL } from "./shared/channels";
import { generateRepairPromptForChanges } from "./shared/exporters";
import type {
  DiagnosticFilter,
  DiagnosticGroup,
  LiveDiagnosticEvent,
  NetworkDetailTab,
  OverlayTab,
  PanelSettings,
  PerformanceInsights,
  StyleChange,
  UiLocale
} from "./content/types";

type PanelUiState = {
  details: Record<string, boolean>;
  scroll: Array<{
    selector: string;
    index: number;
    left: number;
    top: number;
  }>;
};

const PANEL_SCROLL_SELECTORS = [".panel-content", ".network-list", ".network-detail", ".payload-preview", ".payload-raw", "pre"];

(() => {
  const isolatedWindow = window as any;
  if (isolatedWindow.__DEVLITE_CONTENT_INSTALLED__) {
    return;
  }
  isolatedWindow.__DEVLITE_CONTENT_INSTALLED__ = true;
  const pageMessageTargetOrigin = window.location.origin === "null" ? "*" : window.location.origin;

  let captureActive = false;
  let inspectorActive = false;
  let selectedElement: HTMLElement | null = null;
  let hoveredElement: HTMLElement | null = null;
  let currentChange: StyleChange | null = null;
  let sessionSettings: PanelSettings = {};
  let overlayHost: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let highlighter: HTMLDivElement | null = null;
  let styleEditor: HTMLDivElement | null = null;
  let launcherDockController: LauncherDockController | null = null;
  let panel: HTMLDivElement | null = null;
  let panelOpen = false;
  let activePanelTab: OverlayTab = "element";
  let renderedPanelTab: OverlayTab | null = null;
  let panelRenderVersion = 0;
  let networkDetailTab: NetworkDetailTab = "preview";
  let networkErrorOnly = false;
  let networkListWidth = 260;
  let panelGestureActive = false;
  let diagnosticFilter: DiagnosticFilter = "issues";
  let selectedNetworkEventId: string | null = null;
  let uiLocale: UiLocale = "zh";
  let captureStartPromise: Promise<void> | null = null;
  let captureGeneration = 0;
  const diagnosticEvents = new DiagnosticEventStore();
  let sessionSnapshot: { events?: LiveDiagnosticEvent[]; styleChanges?: StyleChange[] } | null = null;
  let styleChangeSyncPromise: Promise<any> | null = null;
  let imageReplaceInput: HTMLInputElement | null = null;
  const panelPositionController = new PanelPositionController();
  const styleEditorPositionController = new StyleEditorPositionController();
  const diagnosticEventBatcher = new DiagnosticEventBatcher((events) => {
    void sendRuntime({ type: "diagnostic-events", events }).catch(handleAsyncError);
  });
  const panelRefreshController = new PanelRefreshController({
    isEditingField: isEditingPanelField,
    isPanelOpen: () => panelOpen,
    refresh: refreshSessionSnapshot,
    render: renderPanel,
    shouldSkipIntervalRender: () => panelGestureActive || activePanelTab === "element" || isEditingPanelField()
  });
  const inlineTextEditor = new InlineTextEditor({
    canEdit: canEditTextContent,
    ensureBaseline: ensureTextChangeBaseline,
    isCurrentElement: (element) => selectedElement === element,
    onChange: (element) => {
      updateHighlighter(element);
      updateStyleEditorPosition();
      if (panelOpen && activePanelTab === "element") {
        schedulePanelRender();
      }
    },
    onEscape: () => {
      if (panelOpen) renderPanel();
    },
    recordAfter: recordTextAfter,
    t,
    toast
  });
  const performanceMonitor = new PerformanceMonitor({
    isCaptureActive: () => captureActive,
    getInsights: () => getPerformanceInsights(),
    getLocale: () => uiLocale,
    sendDiagnosticEvent
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleRuntimeMessage(message)
      .then((response) => safeSendResponse(sendResponse, response))
      .catch((error) => safeSendResponse(sendResponse, { ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  void loadUiLocale();

  window.addEventListener("message", (event) => {
    if (!isTrustedPageMessage(event)) return;
    const data = event.data;
    if (!data || data.channel !== PAGE_CHANNEL || !data.event) return;
    if (!captureActive) return;
    rememberDiagnosticEvent(data.event);
    diagnosticEventBatcher.enqueue(data.event);
    schedulePanelRender();
  });

  window.addEventListener(
    "error",
    (event) => {
      if (!captureActive) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || !("tagName" in target)) return;
      const tag = target.tagName.toLowerCase();
      const source = "src" in target ? String(target.src) : "href" in target ? String(target.href) : "";
      if (!source) return;
      sendDiagnosticEvent({
	        type: "resource-error",
	        severity: "warning",
	        message: `${tag} ${t("resourceLoadFailed")}`,
        url: source,
        source: tag,
        metadata: {
          outerHTML: target.outerHTML.slice(0, 300)
        }
      });
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Node && overlayHost?.contains(event.target)) return;
      if (captureActive) {
        const target = resolveInspectableTarget(event.target);
        if (target) {
          sendDiagnosticEvent({
            type: "user-click",
            severity: "info",
            message: `${t("userClicked")} ${labelElement(target)}`,
            metadata: {
              selector: buildSelector(target),
              text: textSnippet(target)
            }
          });
        }
      }

      if (inspectorActive) {
        event.preventDefault();
        event.stopPropagation();
        const target = resolveInspectableTarget(event.target);
        if (target && !overlayHost?.contains(target)) {
          selectElement(target);
        }
      }
    },
    true
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      if (inlineTextEditor.isActive()) return;
      if (event.target instanceof Node && overlayHost?.contains(event.target)) return;
      const target = resolveInspectableTarget(event.target);
      if (!target || overlayHost?.contains(target)) return;
      const selected = getConnectedSelectedElement();
      if (!inspectorActive && (!selected || (target !== selected && !selected.contains(target)))) return;
      event.preventDefault();
      event.stopPropagation();
      if (target !== selected || !currentChange) {
        selectElement(target);
      }
      startInlineTextEdit();
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!inspectorActive || (event.target instanceof Node && overlayHost?.contains(event.target))) return;
      const target = resolveInspectableTarget(event.target);
      if (!target || overlayHost?.contains(target)) return;
      hoveredElement = target;
      updateHighlighter(target);
    },
    true
  );

  window.addEventListener("resize", () => {
    launcherDockController?.applyPosition();
    panelPositionController.apply(panel);
    syncElementOverlays();
  });
  window.addEventListener("pagehide", flushDiagnosticEvents);
  document.addEventListener("scroll", syncElementOverlays, true);

  async function handleRuntimeMessage(message: any): Promise<any> {
    if (message?.type === "devlite-ping") {
      return { ok: true };
    }

    if (message?.type === "devlite-start-capture") {
      captureGeneration += 1;
      captureActive = true;
      sessionSettings = mergePanelSettings(message.settings ?? {});
      uiLocale = normalizeLocale(sessionSettings.locale);
      applyOverlayTheme();
      void sendRuntime({ type: "page-context", page: getPageContext() }).catch(handleAsyncError);
      postControlMessage({ type: "start", settings: sessionSettings });
      performanceMonitor.start();
      return { ok: true };
    }

    if (message?.type === "devlite-stop-capture") {
      captureGeneration += 1;
      captureStartPromise = null;
      captureActive = false;
      flushDiagnosticEvents();
      postControlMessage({ type: "stop" });
      performanceMonitor.stop();
      schedulePanelRender();
      return { ok: true };
    }

    if (message?.type === "devlite-open-panel") {
      openPanel();
      return { ok: true };
    }

    if (message?.type === "devlite-start-inspector") {
      startInspector();
      return { ok: true };
    }

    if (message?.type === "devlite-stop-inspector") {
      stopInspector();
      return { ok: true };
    }

    return { ok: false };
  }

  async function loadUiLocale(): Promise<void> {
    try {
      const response = await sendRuntime({ type: "get-settings" });
      if (!response?.ok) return;
      sessionSettings = mergePanelSettings(response.settings ?? {});
      uiLocale = normalizeLocale(response.settings?.locale);
      applyOverlayTheme();
      syncLauncherLabels();
      if (panelOpen) renderPanel();
      if (styleEditor && !styleEditor.hidden) renderStyleEditor();
    } catch (error) {
      handleAsyncError(error);
    }
  }

  function t(key: ContentTextKey): string {
    return contentText(uiLocale, key);
  }

  function startInspector(): void {
    stopInlineTextEdit();
    inspectorActive = true;
    ensureOverlay();
    activePanelTab = "element";
    hideStyleEditor();
    hidePanel();
    void ensureCapture().catch(handleAsyncError);
    document.documentElement.style.cursor = "crosshair";
  }

  function stopInspector(): void {
    inspectorActive = false;
    hoveredElement = null;
    document.documentElement.style.cursor = "";
    hideHighlighter();
    if (panelOpen) {
      renderPanel();
    }
  }

  function openPanel(tab: OverlayTab = "element"): void {
    ensureOverlay();
    activePanelTab = tab;
    panelOpen = true;
    renderPanel();
    startPanelRefresh();
    void ensureCapture().then(async () => {
      await ensureResponseBodyCapture();
      if (panelOpen) renderPanel();
    }).catch(handleAsyncError);
  }

  function ensureOverlay(): void {
    if (overlayHost && shadow) return;
    overlayHost = document.createElement("div");
    overlayHost.id = "devlite-overlay-root";
    overlayHost.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    shadow = overlayHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = overlayStyles();
    highlighter = document.createElement("div");
    highlighter.className = "devlite-highlighter";
    styleEditor = document.createElement("div");
    styleEditor.className = "style-editor-popover";
    styleEditor.hidden = true;
    imageReplaceInput = document.createElement("input");
    imageReplaceInput.type = "file";
    imageReplaceInput.accept = "image/*,.svg";
    imageReplaceInput.hidden = true;
    launcherDockController = new LauncherDockController({
      t,
      onOpenPanel: () => openPanel(),
      onStartInspector: () => startInspector(),
      onToast: toast,
      initialTop: Math.round(window.innerHeight / 2)
    });
    panel = document.createElement("div");
    panel.className = "devlite-panel";
    panel.hidden = true;
    shadow.append(style, highlighter, launcherDockController.element, styleEditor, imageReplaceInput, panel);
    bindImageFileInput({
      input: imageReplaceInput,
      onError: () => toast(t("replaceImageFailed")),
      onLoad: replaceSelectedImage
    });
    document.documentElement.appendChild(overlayHost);
    applyOverlayTheme();
    launcherDockController.applyPosition();
  }

  ensureOverlay();

  function syncLauncherLabels(): void {
    launcherDockController?.syncLabels(t);
  }

  function hideHighlighter(): void {
    if (highlighter) {
      highlighter.style.display = "none";
    }
  }

  function hideStyleEditor(): void {
    if (!styleEditor) return;
    styleEditorPositionController.reset();
    styleEditor.hidden = true;
    styleEditor.innerHTML = "";
  }

  function hidePanel(): void {
    if (!panel) return;
    panelOpen = false;
    renderedPanelTab = null;
    stopPanelRefresh();
    panel.hidden = true;
    panel.innerHTML = "";
  }

  function updateHighlighter(element: HTMLElement): void {
    ensureOverlay();
    if (!highlighter) return;
    if (!element.isConnected) {
      hideHighlighter();
      return;
    }
    const rect = element.getBoundingClientRect();
    highlighter.style.display = "block";
    highlighter.style.transform = `translate(${Math.max(0, rect.left)}px, ${Math.max(0, rect.top)}px)`;
    highlighter.style.width = `${Math.max(0, rect.width)}px`;
    highlighter.style.height = `${Math.max(0, rect.height)}px`;
    highlighter.textContent = "";
  }

  function selectElement(element: HTMLElement): void {
    stopInlineTextEdit();
    styleEditorPositionController.reset();
    selectedElement = element;
    updateHighlighter(element);
    currentChange = createStyleChange(element, EDITABLE_PROPS);
    inspectorActive = false;
    document.documentElement.style.cursor = "";
    activePanelTab = "element";
    renderStyleEditor();
    if (panelOpen) {
      renderPanel();
    }
  }

  function syncElementOverlays(): void {
    if (inspectorActive && hoveredElement) {
      if (!hoveredElement.isConnected) {
        hoveredElement = null;
        hideHighlighter();
        return;
      }
      updateHighlighter(hoveredElement);
      return;
    }
    const element = getConnectedSelectedElement();
    if (!element) return;
    updateHighlighter(element);
    updateStyleEditorPosition();
  }

  function renderPanel(): void {
    ensureOverlay();
    if (!panel) return;
    panelOpen = true;
    panel.hidden = false;
    panelPositionController.apply(panel);

    const renderVersion = ++panelRenderVersion;
    const uiState = renderedPanelTab === activePanelTab ? capturePanelUiState(panel) : null;
    const tabBody = renderActivePanelTab();

    panel.innerHTML = renderPanelShell({
      activeTab: activePanelTab,
      captureActive,
      counts: {
        changes: getStyleChangeRecords().length,
        diagnostics: getProblemEvents().length,
        network: getNetworkEvents().length,
        performance: getPerformanceInsights().issues.length
      },
      inspectorActive,
      tabBody,
      uiLocale,
      t
    });
    bindPanelEvents({
      panel,
      onAction: handlePanelScopedAction,
      onDiagnosticFilter: (filter) => {
        diagnosticFilter = filter;
        renderPanel();
      },
      onNetworkDetail: (tab) => {
        networkDetailTab = tab;
        renderPanel();
      },
      onNetworkEvent: (id) => {
        selectedNetworkEventId = id;
        renderPanel();
      },
      onNetworkListResize: startNetworkListResize,
      onError: showInteractionError,
      onStartDrag: startPanelDrag,
      onStartResize: startPanelResize,
      onStyleInput: applyStyle,
      onTab: (tab) => {
        activePanelTab = tab;
        renderPanel();
      },
      onTextInput: applyTextContent,
      onThemeChange: (theme) => void applyPanelThemeSelection(theme)
    });
    renderedPanelTab = activePanelTab;
    panelPositionController.apply(panel);
    if (uiState) {
      restorePanelUiState(panel, uiState);
      window.requestAnimationFrame(() => {
        if (renderVersion === panelRenderVersion) restorePanelUiState(panel, uiState);
      });
    }
  }

  async function handlePanelScopedAction(action: string, source?: HTMLElement): Promise<void> {
    if (action === "copy-prompt" && activePanelTab === "element") {
      await copySelectedStylePrompt();
      return;
    }
    if (action === "select-all-style-records") {
      selectAllStyleRecords();
      return;
    }
    if (action === "undo-style-record") {
      await undoStyleChangeById(source?.dataset.changeId ?? "");
      return;
    }
    if (action === "clear-network-events") {
      await clearNetworkEvents();
      return;
    }
    if (action === "toggle-network-errors") {
      networkErrorOnly = !networkErrorOnly;
      selectedNetworkEventId = null;
      renderPanel();
      return;
    }

    await handlePanelAction(action, {
      applyStyle,
      buildPerformancePrompt,
      closePanel,
      ensureCapture,
      ensureResponseBodyCapture,
      eventTypeLabel,
      getCurrentChange: () => currentChange,
      getPanel: () => panel,
      getPendingStyleSync: () => styleChangeSyncPromise,
      getProblemEvents,
      getSelectedNetworkEvent: getSelectedNetworkEventForAction,
      getSelectedElement: getConnectedSelectedElement,
      getSettings: mergedPanelSettings,
      renderPanel,
      savePanelSettings,
      sendRuntime,
      showSettings: () => {
        activePanelTab = "settings";
        renderPanel();
      },
      startInlineTextEdit,
      startInspector,
      stopInlineTextEdit,
      stopInspector,
      t,
      toast,
      toggleLocale,
      undoCurrentChange
    });
  }

  function renderActivePanelTab(): string {
    if (activePanelTab === "element") return renderElementTab();
    if (activePanelTab === "diagnostics") return renderDiagnosticsTab();
    if (activePanelTab === "network") return renderNetworkTab();
    if (activePanelTab === "performance") return renderPerformanceTab();
    return renderSettingsTab();
  }


  function renderElementTab(): string {
    return renderElementTabView({
      records: getStyleChangeRecords(),
      inspectorActive,
      locale: uiLocale,
      t,
      formatTime
    });
  }

  function renderSettingsTab(): string {
    return renderSettingsTabView({ settings: mergedPanelSettings(), t });
  }

  function getStyleChangeRecords(): StyleChange[] {
    return getRecordedStyleChanges(sessionSnapshot?.styleChanges, currentChange);
  }

  async function copySelectedStylePrompt(): Promise<void> {
    const selectedIds = new Set(
      Array.from(panel?.querySelectorAll<HTMLInputElement>("input[data-style-record-select]:checked") ?? []).map((input) => input.value)
    );
    if (selectedIds.size === 0) {
      toast(t("noSelectedElements"));
      return;
    }
    const selectedChanges = getStyleChangeRecords().filter((change) => selectedIds.has(change.id));
    if (selectedChanges.length === 0) {
      toast(t("noSelectedElements"));
      return;
    }
    await copyText(generateRepairPromptForChanges(selectedChanges, uiLocale, getPageContext()));
    toast(t("fullPromptCopied"));
  }

  function selectAllStyleRecords(): void {
    const inputs = Array.from(panel?.querySelectorAll<HTMLInputElement>("input[data-style-record-select]") ?? []);
    const shouldSelectAll = inputs.some((input) => !input.checked);
    inputs.forEach((input) => {
      input.checked = shouldSelectAll;
    });
  }

  async function undoStyleChangeById(id: string): Promise<void> {
    const change = getStyleChangeRecords().find((item) => item.id === id);
    if (!change) return;
    const element = resolveStyleChangeElement(change);
    if (!element) {
      toast(t("elementRestoreFailed"));
      return;
    }

    stopInlineTextEdit();
    const wasSelected = currentChange?.id === change.id || selectedElement === element;
    undoStyleChange(change, element);
    await sendRuntime({ type: "style-change-delete", id: change.id });
    removeLocalStyleChange(change.id);
    if (wasSelected) {
      currentChange = null;
      selectedElement = null;
      hideHighlighter();
      hideStyleEditor();
    }
    renderPanel();
    toast(t("elementRestored"));
  }

  function resolveStyleChangeElement(change: StyleChange): HTMLElement | null {
    if (currentChange?.id === change.id && selectedElement?.isConnected) return selectedElement;
    try {
      const element = document.querySelector(change.selector);
      return element instanceof HTMLElement ? element : null;
    } catch {
      return null;
    }
  }

  function removeLocalStyleChange(id: string): void {
    if (sessionSnapshot) {
      sessionSnapshot = {
        ...sessionSnapshot,
        styleChanges: (sessionSnapshot.styleChanges ?? []).filter((change) => change.id !== id)
      };
    }
    if (currentChange?.id === id) {
      currentChange = null;
    }
  }

  function renderStyleEditor(): void {
    ensureOverlay();
    const element = getConnectedSelectedElement();
    if (!styleEditor || !element || !currentChange) return;
    styleEditor.hidden = false;
    styleEditor.innerHTML = renderStyleEditorView({
      element,
      change: currentChange,
      canEditText: canEditTextContent(element),
      t
    });
    bindStyleEditorEvents({
      editor: styleEditor,
      onAction: handleStyleEditorAction,
      onError: showInteractionError,
      onStartDrag: startStyleEditorDrag,
      onStyleInput: applyStyle
    });
    updateStyleEditorPosition();
  }

  async function handleStyleEditorAction(action: string): Promise<void> {
    if (action === "back-panel") {
      hideStyleEditor();
      hideHighlighter();
      openPanel("element");
      return;
    }
    if (action === "copy-element") {
      await copySelectedElement();
      return;
    }
    if (action === "replace-image") {
      startImageReplacement();
      return;
    }
    if (action === "replace-icon") {
      replaceSelectedIcon();
      return;
    }
    if (action === "text") {
      startInlineTextEdit();
      return;
    }
    if (action === "select") {
      startInspector();
      return;
    }
    if (action === "undo") {
      await undoCurrentChange();
    }
  }

  async function copySelectedElement(): Promise<void> {
    const element = getConnectedSelectedElement();
    if (!element) return;
    await copyText(element.outerHTML);
    toast(t("elementCopied"));
  }

  function startImageReplacement(): void {
    if (!getConnectedSelectedElement() || !currentChange || !imageReplaceInput) return;
    imageReplaceInput.click();
  }

  function replaceSelectedImage(src: string, label = ""): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    applyImageReplacement(currentChange, element, src, label ? `${t("replaceImage")}: ${label}` : t("replaceImage"));
    syncCurrentChange();
    updateHighlighter(element);
    updateStyleEditorPosition();
    if (panelOpen) schedulePanelRender();
    toast(t("imageReplaced"));
  }

  function replaceSelectedIcon(): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    const value = window.prompt(t("replaceIconPrompt"), "");
    const next = value?.trim();
    if (!next) {
      toast(t("iconReplaceEmpty"));
      return;
    }

    applyIconReplacement(currentChange, element, next, t("replaceIcon"));
    syncCurrentChange();
    updateHighlighter(element);
    updateStyleEditorPosition();
    if (panelOpen) schedulePanelRender();
    toast(t("iconReplaced"));
  }

  function updateStyleEditorPosition(): void {
    styleEditorPositionController.update(styleEditor, getConnectedSelectedElement());
  }

  function startStyleEditorDrag(event: PointerEvent): void {
    styleEditorPositionController.startDrag(styleEditor, event);
  }

  function renderDiagnosticsTab(): string {
    return renderDiagnosticsTabView({
      filter: diagnosticFilter,
      issueEvents: getProblemEvents(),
      logEvents: getConsoleLogEvents(),
      t,
      eventTypeLabel,
      formatTime,
      groupEvents: groupDiagnosticEvents
    });
  }

  function renderNetworkTab(): string {
    const allEvents = getNetworkEvents();
    const events = (networkErrorOnly ? allEvents.filter(isNetworkErrorEvent) : allEvents).slice(0, 20);
    const selected = getSelectedNetworkEvent(events);
    return renderNetworkTabView({
      events,
      totalCount: allEvents.length,
      selected,
      detailTab: networkDetailTab,
      filterErrorsOnly: networkErrorOnly,
      listWidth: networkListWidth,
      slowThreshold: Number(sessionSettings.slowRequestThreshold ?? 2000),
      t,
      formatUrl,
      summarizeNetworkData,
      renderPayloadPanel
    });
  }

  function getSelectedNetworkEvent(events: LiveDiagnosticEvent[]): LiveDiagnosticEvent | null {
    const selected = pickSelectedNetworkEvent(events, selectedNetworkEventId);
    const next = selected ? findFreshNetworkEventWithPayload(events, selected) ?? selected : null;
    selectedNetworkEventId = next?.id ?? null;
    return next;
  }

  function getSelectedNetworkEventForAction(): LiveDiagnosticEvent | null {
    const events = (networkErrorOnly ? getNetworkEvents().filter(isNetworkErrorEvent) : getNetworkEvents()).slice(0, 20);
    return getSelectedNetworkEvent(events);
  }

  function isNetworkErrorEvent(event: LiveDiagnosticEvent): boolean {
    return event.severity === "error" || (typeof event.status === "number" && event.status >= 400);
  }

  function startPanelDrag(event: PointerEvent): void {
    if (!panel) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, summary, [data-panel-resize]")) return;
    panelGestureActive = true;
    panelPositionController.startDrag(panel, event, () => {
      panelGestureActive = false;
    });
  }

  function startPanelResize(event: PointerEvent): void {
    if (!panel) return;
    panelGestureActive = true;
    panelPositionController.startResize(panel, event, () => {
      panelGestureActive = false;
    });
  }

  function startNetworkListResize(event: PointerEvent): void {
    const splitter = event.currentTarget as HTMLElement | null;
    const workspace = splitter?.closest<HTMLElement>(".network-workspace");
    const list = workspace?.querySelector<HTMLElement>(".network-list");
    if (!workspace || !list) return;

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = list.getBoundingClientRect().width;
    const minListWidth = 150;
    const minDetailWidth = 260;
    const workspaceWidth = workspace.getBoundingClientRect().width;
    const maxListWidth = Math.max(minListWidth, workspaceWidth - minDetailWidth);
    let frameId: number | null = null;
    let pendingWidth = networkListWidth;
    const clampWidth = (value: number): number => {
      return Math.round(Math.min(Math.max(value, minListWidth), maxListWidth));
    };
    const flushWidth = (): void => {
      frameId = null;
      workspace.style.setProperty("--network-list-width", `${networkListWidth}px`);
    };
    const applyWidth = (value: number): void => {
      pendingWidth = clampWidth(value);
      networkListWidth = pendingWidth;
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(flushWidth);
    };
    const handleMove = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault();
      applyWidth(startWidth + moveEvent.clientX - startX);
    };
    const stopResize = (): void => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        flushWidth();
      }
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      panelGestureActive = false;
    };

    panelGestureActive = true;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function findFreshNetworkEventWithPayload(events: LiveDiagnosticEvent[], selected: LiveDiagnosticEvent): LiveDiagnosticEvent | null {
    const needsRequestBody = !selected.requestBody;
    const needsResponseBody = !selected.responseBody;
    if (!needsRequestBody && !needsResponseBody) return null;
    return (
      events.find((event) => {
        if (event.id === selected.id || event.timestamp <= selected.timestamp) return false;
        if ((event.method || "GET") !== (selected.method || "GET") || event.url !== selected.url) return false;
        return (needsRequestBody && !!event.requestBody) || (needsResponseBody && !!event.responseBody);
      }) ?? null
    );
  }

  function renderPerformanceTab(): string {
    return renderPerformanceTabView({
      insights: getPerformanceInsights(),
      t,
      formatResourceTiming,
      formatTime
    });
  }

  async function toggleLocale(): Promise<void> {
    const response = await sendRuntime({ type: "get-settings" });
    const currentSettings = response?.settings ?? {};
    const nextLocale: UiLocale = uiLocale === "en" ? "zh" : "en";
    const saved = await sendRuntime({
      type: "save-settings",
      settings: {
        ...currentSettings,
        locale: nextLocale
      }
    });
    if (!saved?.ok) {
      toast(saved?.error || t("saveFailed"));
      return;
    }
    sessionSettings = mergePanelSettings(saved.settings ?? { ...currentSettings, locale: nextLocale });
    uiLocale = normalizeLocale(sessionSettings.locale);
    applyOverlayTheme();
    syncInjectedSettings();
    if (panelOpen) renderPanel();
    if (styleEditor && !styleEditor.hidden) renderStyleEditor();
    toast(uiLocale === "en" ? t("switchedEn") : t("switchedZh"));
  }

  async function applyPanelThemeSelection(theme: string): Promise<void> {
    const currentSettings = mergedPanelSettings();
    const nextTheme = normalizeTheme(theme);
    if (nextTheme === currentSettings.uiTheme) return;

    const nextSettings = {
      ...collectPanelSettingsForm(panel, currentSettings),
      uiTheme: nextTheme
    };
    sessionSettings = mergePanelSettings(nextSettings);
    applyOverlayTheme();
    syncInjectedSettings();
    if (panelOpen) renderPanel();

    const response = await sendRuntime({ type: "save-settings", settings: nextSettings });
    if (!response?.ok) {
      sessionSettings = currentSettings;
      applyOverlayTheme();
      syncInjectedSettings();
      if (panelOpen) renderPanel();
      toast(response?.error || t("saveFailed"));
      return;
    }

    sessionSettings = mergePanelSettings(response.settings ?? nextSettings);
    uiLocale = normalizeLocale(sessionSettings.locale);
    applyOverlayTheme();
    syncInjectedSettings();
    syncLauncherLabels();
    if (panelOpen) renderPanel();
    if (styleEditor && !styleEditor.hidden) renderStyleEditor();
    toast(t("settingsSaved"));
  }

  async function savePanelSettings(next: PanelSettings, successMessage = t("settingsSaved")): Promise<void> {
    const response = await sendRuntime({ type: "save-settings", settings: next });
    if (!response?.ok) {
      toast(response?.error || t("saveFailed"));
      return;
    }
    sessionSettings = response.settings ?? mergePanelSettings(next);
    uiLocale = normalizeLocale(sessionSettings.locale);
    applyOverlayTheme();
    syncInjectedSettings();
    syncLauncherLabels();
    if (panelOpen) renderPanel();
    if (styleEditor && !styleEditor.hidden) renderStyleEditor();
    toast(successMessage);
  }

  function mergedPanelSettings(): Required<PanelSettings> {
    return mergePanelSettings(sessionSettings);
  }

  function applyOverlayTheme(): void {
    if (!overlayHost) return;
    const theme = PANEL_THEMES[normalizeTheme(sessionSettings.uiTheme)];
    Object.entries(theme).forEach(([key, value]) => {
      overlayHost?.style.setProperty(`--dl-${key}`, value);
    });
  }

  function applyStyle(prop: string, value: string): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    applyStyleChange(currentChange, element, prop, value);
    syncCurrentChange();
    updateHighlighter(element);
    updateStyleEditorPosition();
    if (panelOpen && activePanelTab === "element") {
      schedulePanelRender();
    }
  }

  function applyTextContent(value: string): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange || !canEditTextContent(element)) return;
    ensureTextChangeBaseline(element);
    replaceEditableText(element, value);
    recordTextAfter(element);
    updateHighlighter(element);
    updateStyleEditorPosition();
    if (panelOpen && activePanelTab === "element") {
      schedulePanelRender();
    }
  }

  function startInlineTextEdit(): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) {
      toast(t("noEditableText"));
      return;
    }
    inlineTextEditor.start(element);
  }

  function stopInlineTextEdit(): void {
    inlineTextEditor.stop();
  }

  function ensureTextChangeBaseline(element: HTMLElement): void {
    if (!currentChange) return;
    ensureTextChangeRecordBaseline(currentChange, element);
  }

  function recordTextAfter(element: HTMLElement): void {
    if (!currentChange) return;
    recordTextChangeAfter(currentChange, element);
    syncCurrentChange();
  }

  function syncCurrentChange(): void {
    if (!currentChange) return;
    const sync = sendRuntime({ type: "style-change-upsert", change: currentChange }).catch((error) => {
      handleAsyncError(error);
      return null;
    });
    styleChangeSyncPromise = sync;
    void sync.finally(() => {
      if (styleChangeSyncPromise === sync) {
        styleChangeSyncPromise = null;
      }
    });
  }

  async function undoCurrentChange(): Promise<void> {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    const change = currentChange;
    undoStyleChange(change, element);
    await sendRuntime({ type: "style-change-delete", id: change.id });
    removeLocalStyleChange(change.id);
    currentChange = null;
    selectedElement = null;
    hideHighlighter();
    hideStyleEditor();
    renderPanel();
  }

  function sendDiagnosticEvent(event: Record<string, unknown>): void {
    const diagnosticEvent = {
      id: randomId(),
      timestamp: Date.now(),
      ...event
    } as LiveDiagnosticEvent;
    rememberDiagnosticEvent(diagnosticEvent);
    diagnosticEventBatcher.enqueue(diagnosticEvent);
    schedulePanelRender();
  }

  function flushDiagnosticEvents(): void {
    diagnosticEventBatcher.flush();
  }

  function sendRuntime(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function ensureCapture(): Promise<void> {
    if (captureActive) return;
    if (captureStartPromise) return captureStartPromise;
    const generation = captureGeneration + 1;
    captureGeneration = generation;

    captureStartPromise = (async () => {
      const response = await sendRuntime({ type: "start-page-capture", page: getPageContext() });
      if (generation !== captureGeneration) return;
      if (!response?.ok) {
        toast(response?.error || t("startCaptureFailed"));
        return;
      }
      sessionSettings = mergePanelSettings(response.settings ?? {});
      uiLocale = normalizeLocale(sessionSettings.locale);
      sessionSnapshot = response.session ?? null;
      captureActive = true;
      mergeSessionEvents(sessionSnapshot?.events ?? []);
      void sendRuntime({ type: "page-context", page: getPageContext() }).catch(handleAsyncError);
      postControlMessage({ type: "start", settings: sessionSettings });
      performanceMonitor.start();
      schedulePanelRender();
    })().finally(() => {
      if (generation === captureGeneration) {
        captureStartPromise = null;
      }
    });

    return captureStartPromise;
  }

  async function ensureResponseBodyCapture(showToast = false): Promise<void> {
    if (sessionSettings.collectResponseBody) {
      syncInjectedSettings();
      return;
    }
    const response = await sendRuntime({ type: "enable-tab-response-body" });
    if (response?.ok) {
      sessionSettings = mergePanelSettings(response.settings ?? { ...sessionSettings, collectResponseBody: true });
      applyOverlayTheme();
      syncInjectedSettings();
      if (panelOpen) schedulePanelRender();
      if (showToast) toast(t("responseBodyEnabled"));
      return;
    }
    if (showToast) toast(response?.error || t("enableFailed"));
  }

  async function refreshSessionSnapshot(): Promise<void> {
    const response = await sendRuntime({ type: "get-tab-session" });
    if (!response?.ok) return;
    const previousSettings = sessionSettings;
    const nextSettings = mergePanelSettings(response.settings ?? sessionSettings);
    const shouldSyncSettings =
      captureActive &&
      (previousSettings.collectResponseBody !== nextSettings.collectResponseBody ||
        previousSettings.maxResponseLength !== nextSettings.maxResponseLength ||
        previousSettings.slowRequestThreshold !== nextSettings.slowRequestThreshold);
    sessionSettings = nextSettings;
    uiLocale = normalizeLocale(sessionSettings.locale);
    applyOverlayTheme();
    sessionSnapshot = response.session ?? null;
    mergeSessionEvents(sessionSnapshot?.events ?? []);
    if (shouldSyncSettings) syncInjectedSettings();
  }

  function closePanel(): void {
    stopInlineTextEdit();
    stopInspector();
    selectedElement = null;
    currentChange = null;
    hideHighlighter();
    hideStyleEditor();
    hidePanel();
  }

  function startPanelRefresh(): void {
    panelRefreshController.start();
  }

  function stopPanelRefresh(): void {
    panelRefreshController.stop();
  }

  function schedulePanelRender(): void {
    if (panelGestureActive) return;
    panelRefreshController.scheduleRender();
  }

  function isEditingPanelField(): boolean {
    const active = shadow?.activeElement as HTMLElement | null;
    return !!active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
  }

  function rememberDiagnosticEvent(event: LiveDiagnosticEvent): void {
    diagnosticEvents.remember(event);
  }

  function mergeSessionEvents(events: LiveDiagnosticEvent[]): void {
    diagnosticEvents.merge(events);
  }

  function getProblemEvents(): LiveDiagnosticEvent[] {
    return diagnosticEvents.getProblemEvents();
  }

  function getNetworkEvents(): LiveDiagnosticEvent[] {
    return diagnosticEvents.getNetworkEvents();
  }

  async function clearNetworkEvents(): Promise<void> {
    diagnosticEventBatcher.removeWhere((event) => event.type === "network");
    diagnosticEvents.clearNetworkEvents();
    selectedNetworkEventId = null;
    if (sessionSnapshot) {
      sessionSnapshot = {
        ...sessionSnapshot,
        events: (sessionSnapshot.events ?? []).filter((event) => event.type !== "network")
      };
    }
    await sendRuntime({ type: "clear-network-events" });
    await ensureCapture();
    renderPanel();
    toast(t("networkDataCleared"));
  }

  function getConsoleLogEvents(): LiveDiagnosticEvent[] {
    return diagnosticEvents.getConsoleLogEvents();
  }

  function groupDiagnosticEvents(events: LiveDiagnosticEvent[]): DiagnosticGroup[] {
    return diagnosticEvents.group(events, { eventTypeLabel, formatUrl });
  }

  function getPerformanceInsights(): PerformanceInsights {
    return getPerformanceInsightsData(performanceContext());
  }

  function performanceContext() {
    return {
      locale: uiLocale,
      slowThreshold: Number(sessionSettings.slowRequestThreshold ?? 2000),
      pageContext: getPageContext(),
      allEvents: diagnosticEvents.all,
      networkEvents: getNetworkEvents(),
      text: {
        domReadyTime: t("domReadyTime"),
        pageLoadComplete: t("pageLoadComplete"),
        resourceSize: t("resourceSize"),
        longTasks: t("longTasks"),
        over50ms: t("over50ms")
      },
      formatTime,
      formatUrl
    };
  }

  function buildPerformancePrompt(): string {
    return buildPerformancePromptText(performanceContext());
  }

  function formatResourceTiming(resource: PerformanceResourceTiming): string {
    return formatPerformanceResourceTiming(resource, formatUrl);
  }

  function eventTypeLabel(event: LiveDiagnosticEvent): string {
    const labels: Record<string, string> = {
      "js-error": t("jsError"),
      "unhandled-rejection": t("promiseRejection"),
      "console-error": "console.error",
      "console-log": "console.log",
      network: t("requestIssue"),
      "resource-error": t("resourceFailure"),
      performance: t("performanceLabel")
    };
    return labels[event.type] ?? event.type;
  }

  function summarizeNetworkData(event: LiveDiagnosticEvent): string {
    return summarizeNetworkEventData(
      event,
      {
        emptyData: t("emptyData"),
        objectFields: t("objectFields"),
        noResponseBodyCollected: t("noResponseBodyCollected")
      },
      uiLocale
    );
  }

  function renderPayloadPanel(value: string | undefined, emptyText: string): string {
    return renderNetworkPayloadPanel(value, emptyText, uiLocale);
  }

  function formatTime(timestamp: number): string {
    return formatLocalizedTime(timestamp, uiLocale);
  }

  function canEditTextContent(element: HTMLElement): boolean {
    return canEditTextContentBase(element, currentChange?.textAfter !== undefined);
  }

  function toast(message: string): void {
    if (!shadow) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    shadow.appendChild(node);
    window.setTimeout(() => node.remove(), 1800);
  }

  function syncInjectedSettings(): void {
    if (!captureActive) return;
    postControlMessage({ type: "settings", settings: sessionSettings });
  }

  function postControlMessage(message: Record<string, unknown>): void {
    window.postMessage({ channel: CONTROL_CHANNEL, ...message }, pageMessageTargetOrigin);
  }

  function isTrustedPageMessage(event: MessageEvent): boolean {
    return event.source === window && (pageMessageTargetOrigin === "*" || event.origin === window.location.origin);
  }

  function getConnectedSelectedElement(): HTMLElement | null {
    if (!selectedElement) return null;
    if (selectedElement.isConnected) return selectedElement;
    selectedElement = null;
    currentChange = null;
    hideHighlighter();
    hideStyleEditor();
    if (panelOpen) schedulePanelRender();
    return null;
  }

  function replaceEditableText(element: HTMLElement, value: string): void {
    if (element.childElementCount === 0) {
      element.textContent = value;
      return;
    }
    const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (textNode) {
      textNode.textContent = value;
      return;
    }
    element.insertBefore(document.createTextNode(value), element.firstChild);
  }

  function safeSendResponse(sendResponse: (response?: any) => void, response: any): void {
    try {
      sendResponse(response);
    } catch (error) {
      handleAsyncError(error);
    }
  }

  function showInteractionError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    toast(message || t("exportFailed"));
    handleAsyncError(error);
  }

  function handleAsyncError(error: unknown): void {
    console.warn("[DevLite] async operation failed", error);
  }

  function capturePanelUiState(root: ParentNode | null): PanelUiState {
    const state: PanelUiState = { details: {}, scroll: [] };
    if (!root) return state;
    PANEL_SCROLL_SELECTORS.forEach((selector) => {
      root.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
        if (element.scrollTop === 0 && element.scrollLeft === 0) return;
        state.scroll.push({
          selector,
          index,
          left: element.scrollLeft,
          top: element.scrollTop
        });
      });
    });
    root.querySelectorAll<HTMLDetailsElement>("details[data-state-key]").forEach((details) => {
      const key = details.dataset.stateKey;
      if (key) state.details[key] = details.open;
    });
    return state;
  }

  function restorePanelUiState(root: ParentNode | null, state: PanelUiState): void {
    if (!root) return;
    state.scroll.forEach((item) => {
      const element = root.querySelectorAll<HTMLElement>(item.selector).item(item.index);
      if (!element) return;
      element.scrollLeft = item.left;
      element.scrollTop = item.top;
    });
    root.querySelectorAll<HTMLDetailsElement>("details[data-state-key]").forEach((details) => {
      const key = details.dataset.stateKey;
      if (!key || !(key in state.details)) return;
      details.open = state.details[key];
    });
  }

})();
