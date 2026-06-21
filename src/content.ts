import { copyText } from "./content/clipboard";
import {
  applyStyleChange,
  createStyleChange,
  ensureDomChangeBaseline,
  ensureTextChangeBaseline as ensureTextChangeRecordBaseline,
  getPromptableStyleChangeRecords as getPromptableRecordedStyleChanges,
  getStyleChangeRecords as getRecordedStyleChanges,
  getVerifyingStyleChangeRecords as getVerifyingRecordedStyleChanges,
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
import { ImageCropperController } from "./content/imageCropper";
import { bindImageFileInput, type ImageFilePayload } from "./content/imageFileInput";
import { applyIconReplacement, applyImageReplacement } from "./content/imageReplacement";
import { InlineTextEditor } from "./content/inlineTextEditor";
import { LauncherDockController } from "./content/launcherDock";
import { overlayStyles } from "./content/overlayStyles";
import { formatUrl, getPageContext } from "./content/pageContext";
import { handlePanelAction } from "./content/panelActions";
import { bindPanelEvents } from "./content/panelEvents";
import { DEFAULT_PANEL_SETTINGS, EDITABLE_PROPS, PANEL_THEMES } from "./content/panelConfig";
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
import { verifyStyleChange } from "./content/styleVerification";
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
import { renderSkillTabView } from "./content/views/skillTab";
import { renderStyleEditorView } from "./content/views/styleEditorView";
import { CONTROL_CHANNEL, PAGE_CHANNEL } from "./shared/channels";
import {
  diagnosticScopeMetadata,
  isStaleDiagnosticScopeEvent,
  type DiagnosticScope
} from "./shared/diagnosticScope";
import { generateRepairPromptForChanges } from "./shared/exporters";
import type {
  DiagnosticFilter,
  DiagnosticGroup,
  ArchivedStyleChange,
  ImageEditMetadata,
  LiveDiagnosticEvent,
  NetworkDetailTab,
  OverlayTab,
  PanelSettings,
  PerformanceInsights,
  StyleChange,
  StyleChangeArchiveReason,
  UiLocale,
  UiTheme
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
const PANEL_TAB_ORDER: OverlayTab[] = ["element", "diagnostics", "network", "performance", "settings", "skill"];
const DIAGNOSTIC_SCOPE_RESET_DELAY = 1000;

(() => {
  const isolatedWindow = window as any;
  if (isolatedWindow.__DEVLITE_CONTENT_INSTALLED__) {
    return;
  }
  isolatedWindow.__DEVLITE_CONTENT_INSTALLED__ = true;
  const pageMessageTargetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
  const pageMessageToken = randomId();
  const pageLoadId = randomId();
  let pageMutationVersion = 0;
  let diagnosticGeneration = 0;
  let diagnosticScopeResetTimer: number | null = null;
  let verificationTimer: number | null = null;
  let verificationPromise: Promise<void> | null = null;
  let verificationRerunRequested = false;
  let verificationForceRenderRequested = false;
  let suppressVerificationMutations = false;
  const exportedElementRefs = new Map<string, HTMLElement>();

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
  let networkSearchQuery = "";
  let showDevelopmentNetworkTraffic = false;
  let networkListWidth = 260;
  let panelGestureActive = false;
  let diagnosticFilter: DiagnosticFilter = "issues";
  let diagnosticSearchQuery = "";
  let performanceSettingsOpen = false;
  let selectedNetworkEventId: string | null = null;
  let uiLocale: UiLocale = "zh";
  let captureStartPromise: Promise<void> | null = null;
  let captureGeneration = 0;
  const diagnosticEvents = new DiagnosticEventStore();
  let diagnosticRevision = 0;
  let performanceInsightsCache: { key: string; time: number; value: PerformanceInsights } | null = null;
  let sessionSnapshot: {
    diagnosticScope?: DiagnosticScope;
    events?: LiveDiagnosticEvent[];
    styleChanges?: StyleChange[];
    archivedStyleChanges?: ArchivedStyleChange[];
  } | null = null;
  let styleChangeSyncPromise: Promise<any> | null = null;
  let imageReplaceInput: HTMLInputElement | null = null;
  let imageCropperController: ImageCropperController | null = null;
  const toastQueue: string[] = [];
  let visibleToastCount = 0;
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
    if (!data || data.channel !== PAGE_CHANNEL) return;
    if (imageCropperController?.handlePageMessage(data)) return;
    if (!data.event) return;
    if (!captureActive) return;
    const diagnosticEvent = stampDiagnosticEvent(data.event as LiveDiagnosticEvent);
    if (shouldDropDiagnosticEvent(diagnosticEvent)) return;
    rememberDiagnosticEvent(diagnosticEvent);
    diagnosticEventBatcher.enqueue(diagnosticEvent);
    updateLauncherStatus();
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

  document.addEventListener("keydown", handleGlobalKeydown, true);

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
  const colorSchemeMedia =
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  colorSchemeMedia?.addEventListener("change", () => {
    if (normalizeTheme(sessionSettings.uiTheme) === "system") {
      applyOverlayTheme();
      if (panelOpen) renderPanel();
      if (styleEditor && !styleEditor.hidden) renderStyleEditor();
    }
  });
  window.addEventListener("pagehide", flushDiagnosticEvents);
  document.addEventListener("scroll", syncElementOverlays, true);
  observePageMutations();

  async function handleRuntimeMessage(message: any): Promise<any> {
    if (message?.type === "devlite-ping") {
      return { ok: true };
    }

    if (message?.type === "devlite-start-capture") {
      captureGeneration += 1;
      captureActive = true;
      diagnosticGeneration += 1;
      sessionSettings = mergePanelSettings(message.settings ?? {});
      uiLocale = normalizeLocale(sessionSettings.locale);
      applyOverlayTheme();
      pruneStaleDiagnosticEventsForCurrentScope();
      void sendRuntime({ type: "reset-diagnostic-scope", diagnosticScope: currentDiagnosticScope("capture-start") }).catch(handleAsyncError);
      void sendRuntime({ type: "page-context", page: getPageContext() }).catch(handleAsyncError);
      postControlMessage({ type: "start", settings: sessionSettings });
      performanceMonitor.start();
      schedulePanelRender();
      return { ok: true };
    }

    if (message?.type === "devlite-stop-capture") {
      captureGeneration += 1;
      captureStartPromise = null;
      captureActive = false;
      clearDiagnosticScopeResetTimer();
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

  function observePageMutations(): void {
    const observer = new MutationObserver((mutations) => {
      if (suppressVerificationMutations) return;
      const hasPageMutation = mutations.some((mutation) => {
        const target = mutation.target;
        return target instanceof Node && !overlayHost?.contains(target);
      });
      if (!hasPageMutation) return;
      pageMutationVersion += 1;
      scheduleExportedStyleVerification();
      if (captureActive && hasSignificantDiagnosticMutation(mutations)) {
        scheduleDiagnosticScopeReset("page-update");
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function hasSignificantDiagnosticMutation(mutations: MutationRecord[]): boolean {
    return mutations.some((mutation) => {
      const target = mutation.target;
      if (target instanceof Node && overlayHost?.contains(target)) return false;

      if (mutation.type === "childList") {
        if (target === document.head) return true;
        const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
        return changedNodes.some(isSignificantDiagnosticNode);
      }

      if (mutation.type === "attributes" && target instanceof Element) {
        const tagName = target.tagName.toLowerCase();
        return (tagName === "link" || tagName === "script") && ["href", "src", "rel", "type"].includes(mutation.attributeName ?? "");
      }

      if (mutation.type === "characterData") {
        const parent = target.parentElement;
        const tagName = parent?.tagName.toLowerCase();
        return tagName === "style" || tagName === "script";
      }

      return false;
    });
  }

  function isSignificantDiagnosticNode(node: Node): boolean {
    if (node instanceof Element && overlayHost?.contains(node)) return false;
    if (!(node instanceof HTMLElement)) return false;
    const tagName = node.tagName.toLowerCase();
    if (tagName === "style" || tagName === "script" || tagName === "link") return true;
    if (node.querySelector("style, script, link")) return true;
    if (node.matches("main, section, article, [data-root], #root, #__next")) return true;
    return node.querySelectorAll("*").length >= 3;
  }

  function scheduleDiagnosticScopeReset(reason: string): void {
    if (diagnosticScopeResetTimer !== null) {
      window.clearTimeout(diagnosticScopeResetTimer);
    }
    diagnosticScopeResetTimer = window.setTimeout(() => {
      diagnosticScopeResetTimer = null;
      void resetDiagnosticScope(reason).catch(handleAsyncError);
    }, DIAGNOSTIC_SCOPE_RESET_DELAY);
  }

  function clearDiagnosticScopeResetTimer(): void {
    if (diagnosticScopeResetTimer === null) return;
    window.clearTimeout(diagnosticScopeResetTimer);
    diagnosticScopeResetTimer = null;
  }

  async function resetDiagnosticScope(reason: string): Promise<void> {
    if (!captureActive) return;
    diagnosticGeneration += 1;
    const scope = currentDiagnosticScope(reason);
    const changed = pruneStaleDiagnosticEventsForCurrentScope();
    const response = await sendRuntime({ type: "reset-diagnostic-scope", diagnosticScope: scope });
    if (response?.session) {
      sessionSnapshot = response.session;
      mergeSessionEvents(sessionSnapshot?.events ?? []);
    }
    if (changed) {
      schedulePanelRender();
    }
  }

  function currentDiagnosticScope(reason?: string): DiagnosticScope {
    const scope: DiagnosticScope = {
      pageLoadId,
      diagnosticGeneration,
      mutationVersion: pageMutationVersion,
      updatedAt: Date.now()
    };
    if (reason) scope.reason = reason;
    return scope;
  }

  function stampDiagnosticEvent(event: LiveDiagnosticEvent): LiveDiagnosticEvent {
    return {
      ...event,
      metadata: {
        ...(event.metadata ?? {}),
        ...diagnosticScopeMetadata(currentDiagnosticScope())
      }
    };
  }

  function pruneStaleDiagnosticEventsForCurrentScope(): boolean {
    const scope = currentDiagnosticScope();
    const isStale = (event: LiveDiagnosticEvent) => isStaleDiagnosticScopeEvent(event, scope);
    diagnosticEventBatcher.removeWhere(isStale);
    const removed = diagnosticEvents.removeWhere(isStale);
    const previousSelectedNetworkEventId = selectedNetworkEventId;
    let removedFromSnapshot = 0;
    if (sessionSnapshot) {
      const nextEvents = (sessionSnapshot.events ?? []).filter((event) => !isStale(event));
      removedFromSnapshot = (sessionSnapshot.events ?? []).length - nextEvents.length;
      sessionSnapshot = {
        ...sessionSnapshot,
        diagnosticScope: scope,
        events: nextEvents
      };
    }
    if (removed === 0 && removedFromSnapshot === 0) return false;
    if (previousSelectedNetworkEventId && !diagnosticEvents.all.some((event) => event.id === previousSelectedNetworkEventId)) {
      selectedNetworkEventId = null;
    }
    diagnosticRevision += 1;
    invalidatePerformanceInsights();
    updateLauncherStatus();
    return true;
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

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const isEditableTarget = isEditableKeyboardTarget(event);
    const commandKey = event.metaKey || event.ctrlKey;

    if (commandKey && event.shiftKey && event.key.toLowerCase() === "d") {
      if (isEditableTarget) return;
      event.preventDefault();
      panelOpen ? hidePanel() : openPanel(activePanelTab === "settings" ? "element" : activePanelTab);
      return;
    }

    if (event.key === "Escape") {
      if (inlineTextEditor.isActive()) {
        stopInlineTextEdit();
        event.preventDefault();
        return;
      }
      if (isEditableTarget) return;
      if (inspectorActive) {
        stopInspector();
        event.preventDefault();
        return;
      }
      if (panelOpen) {
        hidePanel();
        event.preventDefault();
      }
      return;
    }

    if (panelOpen && commandKey && event.key === "Tab" && !isEditableTarget) {
      event.preventDefault();
      const currentIndex = Math.max(0, PANEL_TAB_ORDER.indexOf(activePanelTab));
      const delta = event.shiftKey ? -1 : 1;
      activePanelTab = PANEL_TAB_ORDER[(currentIndex + delta + PANEL_TAB_ORDER.length) % PANEL_TAB_ORDER.length];
      renderPanel();
    }
  }

  function isEditableKeyboardTarget(event: KeyboardEvent): boolean {
    return event.composedPath().some((target) => {
      if (!(target instanceof HTMLElement)) return false;
      return target.matches("input, select, textarea") || target.isContentEditable;
    });
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
    imageCropperController = new ImageCropperController({
      t,
      sendRequest: postControlMessage,
      onApply: (result) => replaceSelectedImage(result.src, result.label, result.metadata),
      onCancel: () => undefined,
      onError: () => toast(t("replaceImageFailed"))
    });
    bindImageFileInput({
      input: imageReplaceInput,
      onError: () => toast(t("replaceImageFailed")),
      onLoad: handleSelectedImageFile
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
        changes: getPromptableStyleChangeRecords().length,
        diagnostics: getProblemEvents().length,
        network: getNetworkEvents().length,
        performance: getPerformanceInsights().issues.length
      },
      inspectorActive,
      tabBody,
      uiLocale,
      t
    });
    updateLauncherStatus();
    bindPanelEvents({
      panel,
      onAction: handlePanelScopedAction,
      onDiagnosticFilter: (filter) => {
        diagnosticFilter = filter;
        renderPanel();
      },
      onDiagnosticSearch: (value) => {
        diagnosticSearchQuery = value;
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
      onNetworkSearch: (value) => {
        networkSearchQuery = value;
        selectedNetworkEventId = null;
        renderPanel();
      },
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
    if (action === "requeue-style-record") {
      await requeueStyleChangeById(source?.dataset.changeId ?? "");
      return;
    }
    if (action === "verify-style-records") {
      await verifyExportedStyleChanges(true);
      renderPanel();
      return;
    }
    if (action === "archive-style-record") {
      await archiveStyleChangeById(source?.dataset.changeId ?? "", "manual", t("archivedManually"));
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
    if (action === "toggle-development-network") {
      showDevelopmentNetworkTraffic = !showDevelopmentNetworkTraffic;
      selectedNetworkEventId = null;
      renderPanel();
      return;
    }
    if (action === "toggle-performance-settings") {
      performanceSettingsOpen = !performanceSettingsOpen;
      renderPanel();
      return;
    }
    if (action === "reset-performance-settings") {
      await resetPerformanceSettings();
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
      showSkillInstall: () => {
        activePanelTab = "skill";
        renderPanel();
      },
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
    if (activePanelTab === "skill") return renderSkillTab();
    return renderSettingsTab();
  }


  function renderElementTab(): string {
    return renderElementTabView({
      pendingRecords: getPromptableStyleChangeRecords(),
      verifyingRecords: getVerifyingStyleChangeRecords(),
      archivedRecords: getArchivedStyleChangeRecords(),
      inspectorActive,
      locale: uiLocale,
      t,
      formatTime
    });
  }

  function renderSettingsTab(): string {
    return renderSettingsTabView({ settings: mergedPanelSettings(), t });
  }

  function renderSkillTab(): string {
    return renderSkillTabView({ t });
  }

  function getStyleChangeRecords(): StyleChange[] {
    return getRecordedStyleChanges(sessionSnapshot?.styleChanges, currentChange);
  }

  function getPromptableStyleChangeRecords(): StyleChange[] {
    return getPromptableRecordedStyleChanges(sessionSnapshot?.styleChanges, currentChange);
  }

  function getVerifyingStyleChangeRecords(): StyleChange[] {
    return getVerifyingRecordedStyleChanges(sessionSnapshot?.styleChanges, currentChange);
  }

  function getArchivedStyleChangeRecords(): ArchivedStyleChange[] {
    return sessionSnapshot?.archivedStyleChanges ?? [];
  }

  async function copySelectedStylePrompt(): Promise<void> {
    if (styleChangeSyncPromise) {
      await styleChangeSyncPromise.catch(() => null);
    }
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
    await markStyleChangesExported(selectedChanges);
    renderPanel();
    toast(t("promptCopiedPendingVerification"));
  }

  function selectAllStyleRecords(): void {
    const inputs = Array.from(panel?.querySelectorAll<HTMLInputElement>("input[data-style-record-select]") ?? []);
    const shouldSelectAll = inputs.some((input) => !input.checked);
    inputs.forEach((input) => {
      input.checked = shouldSelectAll;
    });
  }

  async function markStyleChangesExported(changes: StyleChange[]): Promise<void> {
    if (changes.length === 0) return;
    const ids = changes.map((change) => change.id);
    const now = Date.now();
    for (const change of changes) {
      const element = resolveStyleChangeElement(change);
      if (element) exportedElementRefs.set(change.id, element);
    }
    updateLocalStyleChanges(ids, (change) => ({
      ...change,
      exportedAt: change.exportedAt ?? now,
      exportedPageLoadId: pageLoadId,
      exportedMutationVersion: pageMutationVersion,
      verificationStatus: "waiting",
      lastVerifiedAt: now,
      lastVerifyReason: t("waitingForPageUpdate")
    }));
    await sendRuntime({
      type: "style-changes-mark-exported",
      ids,
      pageLoadId,
      mutationVersion: pageMutationVersion,
      reason: t("waitingForPageUpdate")
    });
  }

  async function undoStyleChangeById(id: string): Promise<void> {
    const change = getStyleChangeRecords().find((item) => item.id === id);
    if (!change) return;
    const element = resolveStyleChangeElement(change);
    const wasSelected = currentChange?.id === change.id || (!!element && selectedElement === element);

    stopInlineTextEdit();
    if (element) {
      undoStyleChange(change, element);
    } else if (!restoreDeletedElement(change)) {
      toast(t("elementRestoreFailed"));
      return;
    }

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

  async function requeueStyleChangeById(id: string): Promise<void> {
    const change = getStyleChangeRecords().find((item) => item.id === id);
    if (!change) return;
    const nextChange: StyleChange = {
      ...change,
      updatedAt: Date.now()
    };
    delete nextChange.exportedAt;
    delete nextChange.exportedPageLoadId;
    delete nextChange.exportedMutationVersion;
    delete nextChange.verificationStatus;
    delete nextChange.lastVerifiedAt;
    delete nextChange.lastVerifyReason;

    updateLocalStyleChanges([id], () => nextChange);
    exportedElementRefs.delete(id);
    await sendRuntime({ type: "style-change-upsert", change: nextChange });
    renderPanel();
    toast(t("styleRecordRequeued"));
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

  function scheduleExportedStyleVerification(): void {
    if (verificationTimer !== null) {
      window.clearTimeout(verificationTimer);
    }
    verificationTimer = window.setTimeout(() => {
      verificationTimer = null;
      void verifyExportedStyleChanges(false).catch(handleAsyncError);
    }, 350);
  }

  async function verifyExportedStyleChanges(forceRender: boolean): Promise<void> {
    if (verificationPromise) {
      verificationRerunRequested = true;
      verificationForceRenderRequested = verificationForceRenderRequested || forceRender;
      return verificationPromise;
    }

    verificationForceRenderRequested = verificationForceRenderRequested || forceRender;
    verificationPromise = runExportedStyleVerificationLoop().finally(() => {
      verificationPromise = null;
    });

    return verificationPromise;
  }

  async function runExportedStyleVerificationLoop(): Promise<void> {
    do {
      const startedMutationVersion = pageMutationVersion;
      const forceRender = verificationForceRenderRequested;
      verificationRerunRequested = false;
      verificationForceRenderRequested = false;

      await runExportedStyleVerificationPass(forceRender);

      if (pageMutationVersion !== startedMutationVersion) {
        verificationRerunRequested = true;
      }
    } while (verificationRerunRequested);
  }

  async function runExportedStyleVerificationPass(forceRender: boolean): Promise<void> {
    const records = getVerifyingStyleChangeRecords();
    if (records.length === 0) return;

    let changed = false;
    for (const change of records) {
      const element = resolveStyleChangeElement(change);
      suppressVerificationMutations = true;
      const result = verifyStyleChange(change, element, {
        pageLoadId,
        mutationVersion: pageMutationVersion,
        exportedElement: exportedElementRefs.get(change.id) ?? null,
        normalizationRoot: shadow,
        t
      });
      window.setTimeout(() => {
        suppressVerificationMutations = false;
      }, 0);

      if (result.status === "verified") {
        await archiveStyleChangeById(change.id, "verified", result.reason, false);
        changed = true;
        continue;
      }

      const nextStatus = result.status;
      if (change.verificationStatus !== nextStatus || change.lastVerifyReason !== result.reason) {
        updateLocalStyleChanges([change.id], (item) => ({
          ...item,
          verificationStatus: nextStatus,
          lastVerifiedAt: Date.now(),
          lastVerifyReason: result.reason
        }));
        await sendRuntime({
          type: "style-change-verification-update",
          id: change.id,
          status: nextStatus,
          reason: result.reason
        });
        changed = true;
      }
    }
    if ((changed || forceRender) && panelOpen && activePanelTab === "element") {
      renderPanel();
    }
  }

  async function archiveStyleChangeById(
    id: string,
    reason: StyleChangeArchiveReason,
    verificationReason: string,
    showToast = true
  ): Promise<void> {
    const change = getStyleChangeRecords().find((item) => item.id === id);
    if (!change) return;
    await sendRuntime({ type: "style-changes-archive", ids: [id], reason, verificationReason });
    archiveLocalStyleChange(change, reason, verificationReason);
    if (currentChange?.id === id) {
      currentChange = null;
    }
    exportedElementRefs.delete(id);
    if (panelOpen && activePanelTab === "element") renderPanel();
    if (showToast) toast(t("elementArchived"));
  }

  function updateLocalStyleChanges(ids: string[], updater: (change: StyleChange) => StyleChange): void {
    const idSet = new Set(ids);
    if (sessionSnapshot) {
      sessionSnapshot = {
        ...sessionSnapshot,
        styleChanges: (sessionSnapshot.styleChanges ?? []).map((change) => (idSet.has(change.id) ? updater(change) : change))
      };
    }
    if (currentChange && idSet.has(currentChange.id)) {
      currentChange = updater(currentChange);
    }
  }

  function archiveLocalStyleChange(change: StyleChange, reason: StyleChangeArchiveReason, verificationReason: string): void {
    if (sessionSnapshot) {
      const archived = sessionSnapshot.archivedStyleChanges ?? [];
      sessionSnapshot = {
        ...sessionSnapshot,
        styleChanges: (sessionSnapshot.styleChanges ?? []).filter((item) => item.id !== change.id),
        archivedStyleChanges: archived.some((item) => item.change.id === change.id)
          ? archived
          : [
              ...archived,
              {
                change: {
                  ...change,
                  verificationStatus: undefined,
                  lastVerifiedAt: Date.now(),
                  lastVerifyReason: verificationReason
                },
                archivedAt: Date.now(),
                archiveReason: reason,
                verificationReason
              }
            ]
      };
    }
  }

  function removeLocalStyleChange(id: string): void {
    if (sessionSnapshot) {
      sessionSnapshot = {
        ...sessionSnapshot,
        styleChanges: (sessionSnapshot.styleChanges ?? []).filter((change) => change.id !== id)
      };
    }
    exportedElementRefs.delete(id);
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
    if (action === "delete-element") {
      deleteSelectedElement();
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

  function deleteSelectedElement(): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    stopInlineTextEdit();

    const parent = element.parentElement;
    const childIndex = parent ? Array.from(parent.children).indexOf(element) : -1;
    ensureDomChangeBaseline(currentChange, element, t("deleteElement"));
    currentChange.domParentSelector = parent ? buildSelector(parent) : undefined;
    currentChange.domChildIndex = childIndex >= 0 ? childIndex : undefined;
    currentChange.domAfter = "";
    currentChange.textSnippet = textSnippet(element);
    currentChange.updatedAt = Date.now();

    element.remove();
    selectedElement = null;
    hideHighlighter();
    hideStyleEditor();
    syncCurrentChange();
    if (panelOpen && activePanelTab === "element") schedulePanelRender();
    toast(t("elementDeleted"));
  }

  function startImageReplacement(): void {
    if (!getConnectedSelectedElement() || !currentChange || !imageReplaceInput) return;
    imageCropperController?.close(false);
    imageReplaceInput.click();
  }

  function handleSelectedImageFile(payload: ImageFilePayload): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    if (payload.isSvg || !payload.type.startsWith("image/")) {
      replaceSelectedImage(payload.src, payload.label);
      return;
    }
    imageCropperController?.start(payload, element);
  }

  function replaceSelectedImage(src: string, label = "", imageEdit?: ImageEditMetadata): void {
    const element = getConnectedSelectedElement();
    if (!element || !currentChange) return;
    applyImageReplacement(currentChange, element, src, label ? `${t("replaceImage")}: ${label}` : t("replaceImage"), imageEdit);
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
    const issueEvents = filterDiagnosticEvents(getProblemEvents());
    const logEvents = filterDiagnosticEvents(getConsoleLogEvents());
    return renderDiagnosticsTabView({
      filter: diagnosticFilter,
      issueEvents,
      logEvents,
      searchQuery: diagnosticSearchQuery,
      t,
      eventTypeLabel,
      formatTime,
      groupEvents: groupDiagnosticEvents
    });
  }

  function renderNetworkTab(): string {
    const storedEvents = getStoredNetworkEvents();
    const tabEvents = getNetworkTabEvents(storedEvents);
    const matchedEvents = getVisibleNetworkEvents(tabEvents);
    const events = matchedEvents.slice(0, 100);
    const selected = getSelectedNetworkEvent(events);
    return renderNetworkTabView({
      events,
      totalCount: storedEvents.length,
      matchedCount: matchedEvents.length,
      selected,
      detailTab: networkDetailTab,
      filterErrorsOnly: networkErrorOnly,
      showDevelopmentTraffic: showDevelopmentNetworkTraffic,
      searchQuery: networkSearchQuery,
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
    const events = getVisibleNetworkEvents(getNetworkTabEvents(getStoredNetworkEvents())).slice(0, 100);
    return getSelectedNetworkEvent(events);
  }

  function isNetworkErrorEvent(event: LiveDiagnosticEvent): boolean {
    return event.severity === "error" || (typeof event.status === "number" && event.status >= 400);
  }

  function shouldDropDiagnosticEvent(event: LiveDiagnosticEvent): boolean {
    return isStaleDiagnosticScopeEvent(event, currentDiagnosticScope()) || (isDevelopmentNetworkEvent(event) && event.metadata?.event === "message");
  }

  function isDevelopmentNetworkEvent(event: LiveDiagnosticEvent): boolean {
    if (event.type !== "network") return false;
    const metadata = event.metadata ?? {};
    if (metadata.devTransport) return true;
    return metadataStringList(metadata.protocols).includes("vite-hmr");
  }

  function metadataStringList(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return typeof value === "string" ? [value] : [];
  }

  function filterDiagnosticEvents(events: LiveDiagnosticEvent[]): LiveDiagnosticEvent[] {
    const query = diagnosticSearchQuery.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) =>
      [event.message, event.source, event.url, event.stack, event.type, event.severity]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }

  function getVisibleNetworkEvents(events: LiveDiagnosticEvent[]): LiveDiagnosticEvent[] {
    const filtered = networkErrorOnly ? events.filter(isNetworkErrorEvent) : events;
    const query = networkSearchQuery.trim().toLowerCase();
    if (!query) return filtered;
    return filtered.filter((event) => {
      const status = typeof event.status === "number" ? String(event.status) : event.severity;
      const contentType = typeof event.metadata?.contentType === "string" ? event.metadata.contentType : "";
      const source = typeof event.metadata?.source === "string" ? event.metadata.source : "";
      const devTransport = typeof event.metadata?.devTransport === "string" ? event.metadata.devTransport : "";
      const eventName = typeof event.metadata?.event === "string" ? event.metadata.event : "";
      return [event.method ?? "GET", event.url ?? "", status, contentType, source, devTransport, eventName, event.message ?? ""].some((value) =>
        value.toLowerCase().includes(query)
      );
    });
  }

  function startPanelDrag(event: PointerEvent): void {
    if (!panel) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button, input, select, textarea, summary, [data-panel-resize]")) return;
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
      settings: mergedPanelSettings(),
      settingsOpen: performanceSettingsOpen,
      performanceEvents: diagnosticEvents.all.filter((event) => event.type === "performance"),
      resourceEntries: performance.getEntriesByType("resource") as PerformanceResourceTiming[],
      t,
      formatResourceTiming,
      formatUrl,
      formatTime
    });
  }

  async function resetPerformanceSettings(): Promise<void> {
    const current = mergedPanelSettings();
    await savePanelSettings(
      {
        ...current,
        performanceTtfbWarning: DEFAULT_PANEL_SETTINGS.performanceTtfbWarning,
        performanceTtfbError: DEFAULT_PANEL_SETTINGS.performanceTtfbError,
        performanceDomReadyWarning: DEFAULT_PANEL_SETTINGS.performanceDomReadyWarning,
        performanceLoadWarning: DEFAULT_PANEL_SETTINGS.performanceLoadWarning,
        performanceLoadError: DEFAULT_PANEL_SETTINGS.performanceLoadError,
        performanceResourceSizeWarning: DEFAULT_PANEL_SETTINGS.performanceResourceSizeWarning
      },
      t("performanceSettingsReset")
    );
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
    const theme = PANEL_THEMES[resolvedPanelTheme(sessionSettings.uiTheme)];
    Object.entries(theme).forEach(([key, value]) => {
      overlayHost?.style.setProperty(`--dl-${key}`, value);
    });
  }

  function resolvedPanelTheme(theme: unknown): Exclude<UiTheme, "system"> {
    const normalized = normalizeTheme(theme);
    if (normalized === "system") {
      return systemPrefersDark() ? "dark" : "claude";
    }
    return normalized;
  }

  function systemPrefersDark(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
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
    if (currentChange.exportedAt) {
      currentChange = {
        ...currentChange,
        exportedAt: undefined,
        exportedPageLoadId: undefined,
        exportedMutationVersion: undefined,
        verificationStatus: undefined,
        lastVerifiedAt: undefined,
        lastVerifyReason: undefined
      };
      exportedElementRefs.delete(currentChange.id);
    }
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
    if (!currentChange) return;
    const change = currentChange;
    const element = getConnectedSelectedElement();
    if (element) {
      undoStyleChange(change, element);
    } else if (!restoreDeletedElement(change)) {
      toast(t("elementRestoreFailed"));
      return;
    }
    await sendRuntime({ type: "style-change-delete", id: change.id });
    removeLocalStyleChange(change.id);
    currentChange = null;
    selectedElement = null;
    hideHighlighter();
    hideStyleEditor();
    renderPanel();
  }

  function restoreDeletedElement(change: StyleChange): HTMLElement | null {
    if (change.domBefore === undefined || change.domAfter !== "") return null;
    const parent = resolveDeletedElementParent(change);
    if (!parent) return null;
    const template = document.createElement("template");
    template.innerHTML = change.domBefore.trim();
    const restored = template.content.firstElementChild;
    if (!(restored instanceof HTMLElement)) return null;
    const before =
      typeof change.domChildIndex === "number" && change.domChildIndex >= 0
        ? parent.children[change.domChildIndex] ?? null
        : null;
    parent.insertBefore(restored, before);
    return restored;
  }

  function resolveDeletedElementParent(change: StyleChange): HTMLElement | null {
    if (!change.domParentSelector) return document.body;
    try {
      const parent = document.querySelector(change.domParentSelector);
      return parent instanceof HTMLElement ? parent : null;
    } catch {
      return null;
    }
  }

  function sendDiagnosticEvent(event: Record<string, unknown>): void {
    const diagnosticEvent = stampDiagnosticEvent({
      id: randomId(),
      timestamp: Date.now(),
      ...event
    } as LiveDiagnosticEvent);
    rememberDiagnosticEvent(diagnosticEvent);
    diagnosticEventBatcher.enqueue(diagnosticEvent);
    updateLauncherStatus();
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
      const response = await sendRuntime({
        type: "start-page-capture",
        page: getPageContext(),
        diagnosticScope: currentDiagnosticScope("page-load")
      });
      if (generation !== captureGeneration) return;
      if (!response?.ok) {
        toast(response?.error || t("startCaptureFailed"));
        return;
      }
      sessionSettings = mergePanelSettings(response.settings ?? {});
      uiLocale = normalizeLocale(sessionSettings.locale);
      sessionSnapshot = response.session ?? null;
      captureActive = true;
      pruneStaleDiagnosticEventsForCurrentScope();
      mergeSessionEvents(sessionSnapshot?.events ?? []);
      void sendRuntime({ type: "page-context", page: getPageContext() }).catch(handleAsyncError);
      postControlMessage({ type: "start", settings: sessionSettings });
      performanceMonitor.start();
      scheduleExportedStyleVerification();
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
    pruneStaleDiagnosticEventsForCurrentScope();
    mergeSessionEvents(sessionSnapshot?.events ?? []);
    if (shouldSyncSettings) syncInjectedSettings();
    scheduleExportedStyleVerification();
  }

  function closePanel(): void {
    stopInlineTextEdit();
    imageCropperController?.close(false);
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
    diagnosticRevision += 1;
    invalidatePerformanceInsights();
    updateLauncherStatus();
  }

  function mergeSessionEvents(events: LiveDiagnosticEvent[]): void {
    const nextEvents = events.filter((event) => !shouldDropDiagnosticEvent(event));
    diagnosticEvents.merge(nextEvents);
    if (nextEvents.length > 0) {
      diagnosticRevision += 1;
      invalidatePerformanceInsights();
      updateLauncherStatus();
    }
  }

  function getProblemEvents(): LiveDiagnosticEvent[] {
    return diagnosticEvents.getProblemEvents().filter((event) => !shouldDropDiagnosticEvent(event) && !isDevelopmentNetworkEvent(event));
  }

  function getNetworkEvents(): LiveDiagnosticEvent[] {
    return getStoredNetworkEvents().filter((event) => !isDevelopmentNetworkEvent(event));
  }

  function getStoredNetworkEvents(): LiveDiagnosticEvent[] {
    return diagnosticEvents.getNetworkEvents().filter((event) => !shouldDropDiagnosticEvent(event));
  }

  function getNetworkTabEvents(events: LiveDiagnosticEvent[]): LiveDiagnosticEvent[] {
    return showDevelopmentNetworkTraffic ? events : events.filter((event) => !isDevelopmentNetworkEvent(event));
  }

  async function clearNetworkEvents(): Promise<void> {
    diagnosticEventBatcher.removeWhere((event) => event.type === "network");
    diagnosticEvents.clearNetworkEvents();
    diagnosticRevision += 1;
    invalidatePerformanceInsights();
    selectedNetworkEventId = null;
    if (sessionSnapshot) {
      sessionSnapshot = {
        ...sessionSnapshot,
        events: (sessionSnapshot.events ?? []).filter((event) => event.type !== "network")
      };
    }
    await sendRuntime({ type: "clear-network-events" });
    await ensureCapture();
    updateLauncherStatus();
    renderPanel();
    toast(t("networkDataCleared"));
  }

  function getConsoleLogEvents(): LiveDiagnosticEvent[] {
    return diagnosticEvents.getConsoleLogEvents().filter((event) => !shouldDropDiagnosticEvent(event));
  }

  function groupDiagnosticEvents(events: LiveDiagnosticEvent[]): DiagnosticGroup[] {
    return diagnosticEvents.group(events, { eventTypeLabel, formatUrl });
  }

  function getPerformanceInsights(): PerformanceInsights {
    const context = performanceContext();
    const key = performanceCacheKey(context);
    const now = Date.now();
    if (performanceInsightsCache && performanceInsightsCache.key === key && now - performanceInsightsCache.time < 3000) {
      return performanceInsightsCache.value;
    }
    const value = getPerformanceInsightsData(context);
    performanceInsightsCache = { key, time: now, value };
    return value;
  }

  function performanceContext() {
    const settings = mergedPanelSettings();
    return {
      locale: uiLocale,
      slowThreshold: settings.slowRequestThreshold,
      thresholds: {
        ttfbWarning: settings.performanceTtfbWarning,
        ttfbError: settings.performanceTtfbError,
        domReadyWarning: settings.performanceDomReadyWarning,
        loadWarning: settings.performanceLoadWarning,
        loadError: settings.performanceLoadError,
        resourceSizeWarning: settings.performanceResourceSizeWarning
      },
      revision: diagnosticRevision,
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

  function performanceCacheKey(context: ReturnType<typeof performanceContext>): string {
    return [
      context.locale,
      context.slowThreshold,
      context.revision,
      JSON.stringify(context.thresholds),
      performance.getEntriesByType("resource").length,
      performance.getEntriesByType("navigation").length
    ].join("|");
  }

  function invalidatePerformanceInsights(): void {
    performanceInsightsCache = null;
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

  function updateLauncherStatus(): void {
    launcherDockController?.updateStatus({
      active: captureActive,
      issues: getProblemEvents().length,
      network: getNetworkEvents().length
    });
  }

  function toast(message: string): void {
    toastQueue.push(message);
    flushToastQueue();
  }

  function flushToastQueue(): void {
    if (!shadow) return;
    while (visibleToastCount < 2 && toastQueue.length > 0) {
      showNextToast(toastQueue.shift() ?? "");
    }
  }

  function showNextToast(message: string): void {
    if (!shadow) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    node.style.bottom = `${18 + visibleToastCount * 42}px`;
    visibleToastCount += 1;
    shadow.appendChild(node);
    window.setTimeout(() => {
      node.remove();
      visibleToastCount = Math.max(0, visibleToastCount - 1);
      flushToastQueue();
    }, 1800);
  }

  function syncInjectedSettings(): void {
    if (!captureActive) return;
    postControlMessage({ type: "settings", settings: sessionSettings });
  }

  function postControlMessage(message: Record<string, unknown>): void {
    window.postMessage({ channel: CONTROL_CHANNEL, token: pageMessageToken, ...message }, pageMessageTargetOrigin);
  }

  function isTrustedPageMessage(event: MessageEvent): boolean {
    const data = event.data;
    return (
      event.source === window &&
      (pageMessageTargetOrigin === "*" || event.origin === window.location.origin) &&
      data?.channel === PAGE_CHANNEL &&
      data?.token === pageMessageToken
    );
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
