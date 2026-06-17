(() => {
  const isolatedWindow = window as any;
  if (isolatedWindow.__DEVLITE_CONTENT_INSTALLED__) {
    return;
  }
  isolatedWindow.__DEVLITE_CONTENT_INSTALLED__ = true;

  type StyleChange = {
    id: string;
    selector: string;
    elementLabel: string;
    textSnippet: string;
    domPath: string;
    locator?: ElementLocator;
    viewport: { width: number; height: number };
    before: Record<string, string>;
    after: Record<string, string>;
    textBefore?: string;
    textAfter?: string;
    htmlBefore?: string;
    htmlAfter?: string;
    updatedAt: number;
    note?: string;
  };

  type InlineTextEditState = {
    element: HTMLElement;
    previousContentEditable: string | null;
    previousSpellcheck: string | null;
    onInput: () => void;
    onBlur: () => void;
    onKeydown: (event: KeyboardEvent) => void;
  };

  type ElementLocator = {
    tagName: string;
    id: string;
    classList: string[];
    attributes: Record<string, string>;
    openingTag: string;
    outerHTMLSnippet: string;
    selector: string;
    domPath: string;
    parentChain: ElementAncestor[];
    matchedCssRules: MatchedCssRule[];
  };

  type ElementAncestor = {
    tagName: string;
    id: string;
    classList: string[];
    selector: string;
  };

  type MatchedCssRule = {
    selectorText: string;
    style: string;
    source: string;
    condition?: string;
  };

  type OverlayTab = "element" | "diagnostics" | "network";

  type LiveDiagnosticEvent = {
    id: string;
    type: string;
    severity: "info" | "warning" | "error";
    timestamp: number;
    message: string;
    source?: string;
    stack?: string;
    url?: string;
    method?: string;
    status?: number;
    duration?: number;
    requestBody?: string;
    responseBody?: string;
    metadata?: Record<string, unknown>;
  };

  const PAGE_CHANNEL = "devlite:page";
  const CONTROL_CHANNEL = "devlite:control";
  const LOGO_URL = chrome.runtime.getURL("icons/devlite-128.png");
  const EDITABLE_PROPS = [
    "color",
    "background-color",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "padding",
    "margin",
    "width",
    "height",
    "border-radius",
    "box-shadow",
    "display",
    "gap",
    "justify-content",
    "align-items",
    "opacity"
  ];

  let captureActive = false;
  let inspectorActive = false;
  let selectedElement: HTMLElement | null = null;
  let hoveredElement: HTMLElement | null = null;
  let currentChange: StyleChange | null = null;
  let sessionSettings: any = {};
  let overlayHost: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let highlighter: HTMLDivElement | null = null;
  let styleEditor: HTMLDivElement | null = null;
  let launcherDock: HTMLDivElement | null = null;
  let launcherTop = Math.round(window.innerHeight / 2);
  let launcherCollapseTimer: number | null = null;
  let suppressLauncherClick = false;
  let panel: HTMLDivElement | null = null;
  let panelPosition = { right: 16, top: 16 };
  let panelOpen = false;
  let activePanelTab: OverlayTab = "element";
  let captureStartPromise: Promise<void> | null = null;
  let panelRefreshTimer: number | null = null;
  let panelRenderQueued = false;
  let liveEvents: LiveDiagnosticEvent[] = [];
  let sessionSnapshot: { events?: LiveDiagnosticEvent[]; styleChanges?: StyleChange[] } | null = null;
  let styleChangeSyncPromise: Promise<any> | null = null;
  let inlineTextEditState: InlineTextEditState | null = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void handleRuntimeMessage(message).then(sendResponse);
    return true;
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== PAGE_CHANNEL || !data.event) return;
    if (!captureActive) return;
    rememberDiagnosticEvent(data.event);
    sendRuntime({ type: "diagnostic-event", event: data.event });
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
        message: `${tag} 资源加载失败`,
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
      if (isOverlayEvent(event)) return;
      if (captureActive) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target) {
          sendDiagnosticEvent({
            type: "user-click",
            severity: "info",
            message: `用户点击 ${labelElement(target)}`,
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
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target && !isOverlayNode(target)) {
          selectElement(target);
        }
      }
    },
    true
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      if (inlineTextEditState) return;
      if (isOverlayEvent(event)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || isOverlayNode(target)) return;
      if (!inspectorActive && (!selectedElement || (target !== selectedElement && !selectedElement.contains(target)))) return;
      event.preventDefault();
      event.stopPropagation();
      if (target !== selectedElement || !currentChange) {
        selectElement(target);
      }
      startInlineTextEdit();
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!inspectorActive || isOverlayEvent(event)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || isOverlayNode(target)) return;
      hoveredElement = target;
      updateHighlighter(target);
    },
    true
  );

  window.addEventListener("resize", () => {
    applyLauncherPosition();
    applyPanelPosition();
    syncElementOverlays();
  });
  document.addEventListener("scroll", syncElementOverlays, true);

  async function handleRuntimeMessage(message: any): Promise<any> {
    if (message?.type === "devlite-start-capture") {
      captureActive = true;
      sessionSettings = message.settings ?? {};
      sendRuntime({ type: "page-context", page: getPageContext() });
      window.postMessage({ channel: CONTROL_CHANNEL, type: "start", settings: sessionSettings }, "*");
      return { ok: true };
    }

    if (message?.type === "devlite-stop-capture") {
      captureActive = false;
      window.postMessage({ channel: CONTROL_CHANNEL, type: "stop" }, "*");
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

  function startInspector(): void {
    stopInlineTextEdit();
    inspectorActive = true;
    ensureOverlay();
    activePanelTab = "element";
    hideStyleEditor();
    hidePanel();
    void ensureCapture();
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
    void ensureCapture();
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
    launcherDock = document.createElement("div");
    launcherDock.className = "devlite-dock";
    launcherDock.innerHTML = `
      <div class="launcher-hit-area" aria-hidden="true"></div>
      <div class="launcher-actions" aria-label="DevLite 快捷操作">
        <button class="launcher-action" type="button" data-launcher-action="select" title="快速选择元素" aria-label="快速选择元素">${launcherIcon("select")}</button>
        <button class="launcher-action" type="button" data-launcher-action="panel" title="打开整体面板" aria-label="打开整体面板">${launcherIcon("panel")}</button>
      </div>
      <button class="devlite-launcher" type="button" title="拖动或打开 DevLite" aria-label="拖动或打开 DevLite">
        <img src="${LOGO_URL}" alt="" />
      </button>
    `;
    bindLauncherEvents();
    panel = document.createElement("div");
    panel.className = "devlite-panel";
    panel.hidden = true;
    shadow.append(style, highlighter, launcherDock, styleEditor, panel);
    document.documentElement.appendChild(overlayHost);
    applyLauncherPosition();
  }

  ensureOverlay();

  function hideHighlighter(): void {
    if (highlighter) {
      highlighter.style.display = "none";
    }
  }

  function hideStyleEditor(): void {
    if (!styleEditor) return;
    styleEditor.hidden = true;
    styleEditor.innerHTML = "";
  }

  function hidePanel(): void {
    if (!panel) return;
    panelOpen = false;
    stopPanelRefresh();
    panel.hidden = true;
    panel.innerHTML = "";
  }

  function updateHighlighter(element: HTMLElement): void {
    ensureOverlay();
    if (!highlighter) return;
    const rect = element.getBoundingClientRect();
    highlighter.style.display = "block";
    highlighter.style.transform = `translate(${Math.max(0, rect.left)}px, ${Math.max(0, rect.top)}px)`;
    highlighter.style.width = `${Math.max(0, rect.width)}px`;
    highlighter.style.height = `${Math.max(0, rect.height)}px`;
    highlighter.textContent = "";
  }

  function selectElement(element: HTMLElement): void {
    stopInlineTextEdit();
    selectedElement = element;
    updateHighlighter(element);
    const computed = getComputedStyle(element);
    const before: Record<string, string> = {};
    EDITABLE_PROPS.forEach((prop) => {
      before[prop] = computed.getPropertyValue(prop);
    });
    const selector = buildSelector(element);
    const domPath = buildDomPath(element);
    currentChange = {
      id: `style-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      selector,
      elementLabel: labelElement(element),
      textSnippet: textSnippet(element),
      domPath,
      locator: buildElementLocator(element, selector, domPath),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      before,
      after: {},
      updatedAt: Date.now()
    };
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
      updateHighlighter(hoveredElement);
      return;
    }
    if (!selectedElement) return;
    updateHighlighter(selectedElement);
    updateStyleEditorPosition();
  }

  function renderPanel(): void {
    ensureOverlay();
    if (!panel) return;
    panelOpen = true;
    panel.hidden = false;
    applyPanelPosition();

    const changeCount = getStyleChangeRecords().length;
    const diagnosticCount = getProblemEvents().length;
    const networkCount = getNetworkEvents().length;
    const tabTitle = activePanelTab === "element" ? "修改记录" : activePanelTab === "diagnostics" ? "页面诊断" : "数据获取";
    const tabBody = activePanelTab === "element" ? renderElementTab() : activePanelTab === "diagnostics" ? renderDiagnosticsTab() : renderNetworkTab();

    panel.innerHTML = `
      <div class="panel-shell">
        <aside class="panel-sidebar">
          <div class="panel-brand">
            <img src="${LOGO_URL}" alt="" />
            <div>
              <strong>DevLite</strong>
              <span>${captureActive ? "采集中" : "待采集"}</span>
            </div>
          </div>
          <nav class="panel-nav" aria-label="DevLite 功能">
            ${navButton("element", "元素修改", changeCount)}
            ${navButton("diagnostics", "页面诊断", diagnosticCount)}
            ${navButton("network", "数据获取", networkCount)}
          </nav>
          <div class="sidebar-spacer"></div>
          <button data-action="options" class="config-button">Config</button>
        </aside>
        <section class="panel-main">
          <div class="panel-header">
            <div>
              <strong>${tabTitle}</strong>
              <span>${panelHeaderMeta()}</span>
            </div>
            <button data-action="close" class="icon-button">关闭</button>
          </div>
          <div class="panel-content">
            ${tabBody}
          </div>
        </section>
      </div>
    `;
    bindPanelEvents();
    applyPanelPosition();
  }

  function navButton(tab: OverlayTab, label: string, count: number): string {
    return `
      <button type="button" data-tab="${tab}" class="nav-item ${activePanelTab === tab ? "active" : ""}">
        <span>${label}</span>
        ${count > 0 ? `<strong>${count > 99 ? "99+" : count}</strong>` : ""}
      </button>
    `;
  }

  function panelHeaderMeta(): string {
    if (activePanelTab === "element") {
      const count = getStyleChangeRecords().length;
      return count > 0 ? `${count} 个元素` : inspectorActive ? "点击页面元素完成定位" : "页面浮层负责编辑";
    }
    if (activePanelTab === "diagnostics") {
      const count = getProblemEvents().length;
      return count > 0 ? `${count} 条问题` : "自动监听页面错误";
    }
    const count = getNetworkEvents().length;
    return count > 0 ? `最近 ${Math.min(count, 20)} 条请求` : "自动归纳 network 数据";
  }

  function renderElementTab(): string {
    const records = getStyleChangeRecords();
    return `
      <div class="toolbar">
        <button data-action="quick-select" class="primary">${inspectorActive ? "正在选择" : "选择元素"}</button>
        ${inspectorActive ? `<button data-action="stop-select">停止选择</button>` : ""}
        <button data-action="copy-ai" class="primary">复制全部 Prompt</button>
      </div>
      ${
        records.length === 0
          ? `<div class="empty">暂无修改记录。</div>`
          : `<div class="style-record-list">${records.map((change, index) => renderStyleChangeRecord(change, index)).join("")}</div>`
      }
    `;
  }

  function renderStyleChangeRecord(change: StyleChange, index: number): string {
    return `
      <article class="style-record">
        <div class="style-record-head">
          <strong>${index + 1}. ${escapeHtml(change.elementLabel)}</strong>
          <span>${formatTime(change.updatedAt)}</span>
        </div>
        <code>${escapeHtml(change.selector)}</code>
        <p>${escapeHtml(summarizeStyleChange(change))}</p>
      </article>
    `;
  }

  function getStyleChangeRecords(): StyleChange[] {
    const records = new Map<string, StyleChange>();
    for (const change of sessionSnapshot?.styleChanges ?? []) {
      if (hasRecordedChange(change)) {
        records.set(change.id, change);
      }
    }
    if (currentChange && hasRecordedChange(currentChange)) {
      records.set(currentChange.id, currentChange);
    }
    return Array.from(records.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function hasRecordedChange(change: StyleChange): boolean {
    return Object.keys(change.after).length > 0 || change.textAfter !== undefined || change.htmlAfter !== undefined;
  }

  function summarizeStyleChange(change: StyleChange): string {
    const parts = Object.keys(change.after).map((prop) => stylePropLabel(prop));
    if (change.textAfter !== undefined || change.htmlAfter !== undefined) {
      parts.unshift("文字内容");
    }
    return parts.length > 0 ? parts.join("、") : "已选择，暂无修改";
  }

  function stylePropLabel(prop: string): string {
    const labels: Record<string, string> = {
      color: "文字颜色",
      "background-color": "背景颜色",
      "font-size": "字号",
      "font-weight": "字重",
      "line-height": "行高",
      "letter-spacing": "字距",
      padding: "内边距",
      margin: "外边距",
      width: "宽度",
      height: "高度",
      "border-radius": "圆角",
      "box-shadow": "阴影",
      display: "显示",
      gap: "间距",
      "justify-content": "主轴",
      "align-items": "交叉轴",
      opacity: "透明度"
    };
    return labels[prop] ?? prop;
  }

  function renderTextEditor(element: HTMLElement): string {
    if (!currentChange || !canEditTextContent(element)) {
      return "";
    }
    const value = currentChange.textAfter ?? editableTextValue(element);
    return `
      <div class="text-editor">
        <label class="text-row">
          <span>文字内容</span>
          <textarea data-text-content rows="3">${escapeHtml(value)}</textarea>
        </label>
        <div class="text-actions">
          <button data-action="inline-text-edit" class="primary">直接编辑文字</button>
          <button data-action="copy-text">复制文字</button>
        </div>
      </div>
    `;
  }

  function renderStyleEditor(): void {
    ensureOverlay();
    if (!styleEditor || !selectedElement || !currentChange) return;
    const computed = getComputedStyle(selectedElement);
    const basicRows = [
      inputRow("color", "文字", toHexColor(computed.color), "color"),
      inputRow("background-color", "背景", toHexColor(computed.backgroundColor), "color"),
      inputRow("font-size", "字号", computed.fontSize),
      selectRow("font-weight", "字重", normalizeFontWeight(computed.fontWeight), ["300", "400", "500", "600", "700", "800"])
    ].join("");
    const detailRows = [
      inputRow("line-height", "行高", computed.lineHeight),
      inputRow("letter-spacing", "字距", computed.letterSpacing),
      inputRow("padding", "内边距", computed.padding),
      inputRow("margin", "外边距", computed.margin),
      inputRow("width", "宽度", computed.width),
      inputRow("height", "高度", computed.height),
      inputRow("border-radius", "圆角", computed.borderRadius),
      inputRow("box-shadow", "阴影", computed.boxShadow),
      selectRow("display", "显示", computed.display, ["block", "inline-block", "flex", "inline-flex", "grid", "none"]),
      inputRow("gap", "间距", computed.gap),
      selectRow("justify-content", "主轴", computed.justifyContent, ["normal", "flex-start", "center", "space-between", "space-around", "flex-end"]),
      selectRow("align-items", "交叉轴", computed.alignItems, ["normal", "stretch", "flex-start", "center", "flex-end", "baseline"]),
      inputRow("opacity", "透明度", computed.opacity)
    ].join("");

    styleEditor.hidden = false;
    styleEditor.innerHTML = `
      <div class="style-editor-head">
        <strong>${escapeHtml(currentChange.elementLabel)}</strong>
        <button type="button" data-style-action="close" class="icon-button">关闭</button>
      </div>
      <div class="rows">${basicRows}</div>
      <details class="style-editor-details">
        <summary>更多</summary>
        <div class="rows">${detailRows}</div>
      </details>
      <div class="style-editor-actions">
        ${canEditTextContent(selectedElement) ? `<button type="button" data-style-action="text">编辑文字</button>` : ""}
        <button type="button" data-style-action="select">继续选择</button>
        <button type="button" data-style-action="undo">撤销</button>
      </div>
    `;
    bindStyleEditorEvents();
    updateStyleEditorPosition();
  }

  function bindStyleEditorEvents(): void {
    if (!styleEditor) return;
    styleEditor.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-prop]").forEach((input) => {
      input.addEventListener("input", () => {
        const prop = input.dataset.prop;
        if (!prop || !selectedElement || !currentChange) return;
        applyStyle(prop, input.value);
      });
      input.addEventListener("change", () => {
        const prop = input.dataset.prop;
        if (!prop || !selectedElement || !currentChange) return;
        applyStyle(prop, input.value);
      });
    });

    styleEditor.querySelectorAll<HTMLButtonElement>("[data-style-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.styleAction;
        if (action === "close") {
          hideStyleEditor();
          hideHighlighter();
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
          undoCurrentChange();
        }
      });
    });
  }

  function updateStyleEditorPosition(): void {
    if (!styleEditor || styleEditor.hidden || !selectedElement) return;
    const rect = selectedElement.getBoundingClientRect();
    const editorRect = styleEditor.getBoundingClientRect();
    const width = editorRect.width || 300;
    const height = editorRect.height || 240;
    let left = rect.right + 10;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, rect.right - width);
    }
    let top = Math.max(8, rect.top);
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - height - 8);
    }
    styleEditor.style.left = `${Math.round(left)}px`;
    styleEditor.style.top = `${Math.round(top)}px`;
  }

  function renderDiagnosticsTab(): string {
    const events = getProblemEvents().slice(0, 20);
    if (events.length === 0) {
      return `<div class="empty compact">暂无页面报错。</div>`;
    }

    return `
      <div class="diagnostic-list">
        ${events
          .map(
            (event) => `
              <article class="issue ${event.severity}">
                <div class="issue-head">
                  <strong>${escapeHtml(eventTypeLabel(event))}</strong>
                  <span>${formatTime(event.timestamp)}</span>
                </div>
                <p>${escapeHtml(event.message)}</p>
                ${event.source || event.url ? `<code>${escapeHtml(event.source || event.url || "")}</code>` : ""}
                ${event.stack ? `<pre>${escapeHtml(truncate(event.stack, 520))}</pre>` : ""}
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderNetworkTab(): string {
    const events = getNetworkEvents().slice(0, 20);
    if (events.length === 0) {
      return `<div class="empty compact">暂无 network 数据。</div>`;
    }

    const failed = events.filter((event) => event.severity === "error" || (typeof event.status === "number" && event.status >= 400)).length;
    const slow = events.filter((event) => typeof event.duration === "number" && event.duration >= Number(sessionSettings.slowRequestThreshold ?? 2000)).length;

    return `
      <div class="network-summary">
        <div><strong>${events.length}</strong><span>最新请求</span></div>
        <div><strong>${failed}</strong><span>异常</span></div>
        <div><strong>${slow}</strong><span>慢请求</span></div>
      </div>
      <div class="network-list">
        ${events
          .map(
            (event) => `
              <article class="network-item ${event.severity}">
                <div class="network-line">
                  <strong>${escapeHtml(event.method || "GET")}</strong>
                  <code>${escapeHtml(formatUrl(event.url || ""))}</code>
                  <span>${formatNetworkStatus(event)}</span>
                </div>
                <p>${escapeHtml(summarizeNetworkData(event))}</p>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function bindPanelEvents(): void {
    if (!panel) return;
    panel.querySelectorAll<HTMLElement>(".panel-header, .panel-sidebar").forEach((dragArea) => {
      dragArea.addEventListener("pointerdown", startPanelDrag);
    });

    panel.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const tab = button.dataset.tab as OverlayTab | undefined;
        if (!tab) return;
        activePanelTab = tab;
        renderPanel();
      });
    });

    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-prop]").forEach((input) => {
      input.addEventListener("input", () => {
        const prop = input.dataset.prop;
        if (!prop || !selectedElement || !currentChange) return;
        applyStyle(prop, input.value);
      });
      input.addEventListener("change", () => {
        const prop = input.dataset.prop;
        if (!prop || !selectedElement || !currentChange) return;
        applyStyle(prop, input.value);
      });
    });

    panel.querySelectorAll<HTMLTextAreaElement>("textarea[data-text-content]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        applyTextContent(textarea.value);
      });
      textarea.addEventListener("change", () => {
        applyTextContent(textarea.value);
      });
    });

    panel.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await handlePanelAction(button.dataset.action ?? "");
      });
    });
  }

  async function handlePanelAction(action: string): Promise<void> {
    if (action === "close") {
      closePanel();
      return;
    }

    if (action === "quick-select") {
      await ensureCapture();
      startInspector();
      toast("点击页面元素完成定位");
      return;
    }

    if (action === "continue-select") {
      await ensureCapture();
      startInspector();
      toast("继续选择页面元素");
      return;
    }

    if (action === "stop-select") {
      stopInspector();
      toast("已停止元素选择");
      return;
    }

    if (action === "options") {
      const response = await sendRuntime({ type: "open-options" });
      if (!response?.ok) toast(response?.error || "无法打开配置页");
      return;
    }

    if (action === "copy-selector" && currentChange) {
      await copyText(currentChange.selector);
      toast("Selector 已复制");
      return;
    }

    if (action === "copy-text" && selectedElement) {
      await copyText(editableTextValue(selectedElement));
      toast("文字已复制");
      return;
    }

    if (action === "inline-text-edit") {
      startInlineTextEdit();
      return;
    }

    if (action === "copy-css" && currentChange) {
      await copyText(cssBlock(currentChange.after));
      toast("CSS 已复制");
      return;
    }

    if (action === "copy-ai") {
      if (styleChangeSyncPromise) {
        await styleChangeSyncPromise.catch(() => null);
      }
      const response = await sendRuntime({ type: "generate-export", format: "ai" });
      if (response?.ok && response.text) {
        await copyText(response.text);
        toast("全部修改 Prompt 已复制");
      } else {
        toast(response?.error || "导出失败");
      }
      return;
    }

    if (action === "hide") {
      stopInlineTextEdit();
      applyStyle("display", "none");
      renderPanel();
      return;
    }

    if (action === "undo") {
      stopInlineTextEdit();
      undoCurrentChange();
    }
  }

  function applyStyle(prop: string, value: string): void {
    if (!selectedElement || !currentChange) return;
    selectedElement.style.setProperty(prop, value);
    currentChange.after[prop] = value;
    currentChange.updatedAt = Date.now();
    syncCurrentChange();
    updateHighlighter(selectedElement);
    updateStyleEditorPosition();
    if (panelOpen && activePanelTab === "element") {
      schedulePanelRender();
    }
  }

  function applyTextContent(value: string): void {
    if (!selectedElement || !currentChange || !canEditTextContent(selectedElement)) return;
    ensureTextChangeBaseline(selectedElement);
    selectedElement.textContent = value;
    recordTextAfter(selectedElement);
    updateHighlighter(selectedElement);
    updateStyleEditorPosition();
    if (panelOpen && activePanelTab === "element") {
      schedulePanelRender();
    }
  }

  function startInlineTextEdit(): void {
    if (!selectedElement || !currentChange || !canEditTextContent(selectedElement)) {
      toast("当前元素没有可编辑文字");
      return;
    }

    if (inlineTextEditState?.element === selectedElement) {
      focusEditableElement(selectedElement);
      return;
    }

    stopInlineTextEdit();
    const element = selectedElement;
    ensureTextChangeBaseline(element);

    const state: InlineTextEditState = {
      element,
      previousContentEditable: element.getAttribute("contenteditable"),
      previousSpellcheck: element.getAttribute("spellcheck"),
      onInput: () => {
        if (selectedElement !== element) return;
        recordTextAfter(element);
        updateHighlighter(element);
        updateStyleEditorPosition();
        if (panelOpen && activePanelTab === "element") {
          schedulePanelRender();
        }
      },
      onBlur: () => {
        stopInlineTextEdit();
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          stopInlineTextEdit();
          if (panelOpen) renderPanel();
        }
      }
    };

    inlineTextEditState = state;
    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute("spellcheck", "false");
    element.addEventListener("input", state.onInput);
    element.addEventListener("blur", state.onBlur);
    element.addEventListener("keydown", state.onKeydown);
    focusEditableElement(element);
    toast("可直接修改页面文字，Esc 结束");
  }

  function stopInlineTextEdit(): void {
    const state = inlineTextEditState;
    if (!state) return;
    state.element.removeEventListener("input", state.onInput);
    state.element.removeEventListener("blur", state.onBlur);
    state.element.removeEventListener("keydown", state.onKeydown);
    if (state.previousContentEditable === null) {
      state.element.removeAttribute("contenteditable");
    } else {
      state.element.setAttribute("contenteditable", state.previousContentEditable);
    }
    if (state.previousSpellcheck === null) {
      state.element.removeAttribute("spellcheck");
    } else {
      state.element.setAttribute("spellcheck", state.previousSpellcheck);
    }
    inlineTextEditState = null;
  }

  function ensureTextChangeBaseline(element: HTMLElement): void {
    if (!currentChange) return;
    if (currentChange.textBefore === undefined) {
      currentChange.textBefore = editableTextValue(element);
    }
    if (currentChange.htmlBefore === undefined) {
      currentChange.htmlBefore = element.innerHTML;
    }
  }

  function recordTextAfter(element: HTMLElement): void {
    if (!currentChange) return;
    currentChange.textAfter = editableTextValue(element);
    currentChange.htmlAfter = element.innerHTML;
    currentChange.textSnippet = truncateText(currentChange.textAfter.replace(/\s+/g, " ").trim(), 140);
    currentChange.updatedAt = Date.now();
    syncCurrentChange();
  }

  function syncCurrentChange(): void {
    if (!currentChange) return;
    const sync = sendRuntime({ type: "style-change-upsert", change: currentChange });
    styleChangeSyncPromise = sync;
    void sync.finally(() => {
      if (styleChangeSyncPromise === sync) {
        styleChangeSyncPromise = null;
      }
    });
  }

  function undoCurrentChange(): void {
    if (!selectedElement || !currentChange) return;
    for (const prop of Object.keys(currentChange.after)) {
      selectedElement.style.setProperty(prop, currentChange.before[prop] ?? "");
    }
    if (currentChange.htmlBefore !== undefined) {
      selectedElement.innerHTML = currentChange.htmlBefore;
    } else if (currentChange.textBefore !== undefined) {
      selectedElement.textContent = currentChange.textBefore;
    }
    sendRuntime({ type: "style-change-delete", id: currentChange.id });
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
    sendRuntime({
      type: "diagnostic-event",
      event: diagnosticEvent
    });
    schedulePanelRender();
  }

  function sendRuntime(message: any): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }

  async function ensureCapture(): Promise<void> {
    if (captureActive) return;
    if (captureStartPromise) return captureStartPromise;

    captureStartPromise = (async () => {
      const response = await sendRuntime({ type: "start-page-capture", page: getPageContext() });
      if (!response?.ok) {
        toast(response?.error || "无法启动页面采集");
        return;
      }
      sessionSettings = response.settings ?? {};
      sessionSnapshot = response.session ?? null;
      captureActive = true;
      mergeSessionEvents(sessionSnapshot?.events ?? []);
      sendRuntime({ type: "page-context", page: getPageContext() });
      window.postMessage({ channel: CONTROL_CHANNEL, type: "start", settings: sessionSettings }, "*");
      schedulePanelRender();
    })().finally(() => {
      captureStartPromise = null;
    });

    return captureStartPromise;
  }

  async function refreshSessionSnapshot(): Promise<void> {
    const response = await sendRuntime({ type: "get-tab-session" });
    if (!response?.ok) return;
    sessionSettings = response.settings ?? sessionSettings;
    sessionSnapshot = response.session ?? null;
    mergeSessionEvents(sessionSnapshot?.events ?? []);
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
    if (panelRefreshTimer !== null) return;
    void refreshSessionSnapshot().then(() => {
      if (panelOpen) renderPanel();
    });
    panelRefreshTimer = window.setInterval(() => {
      void refreshSessionSnapshot().then(() => {
        if (!panelOpen || activePanelTab === "element" || isEditingPanelField()) return;
        renderPanel();
      });
    }, 1400);
  }

  function stopPanelRefresh(): void {
    if (panelRefreshTimer === null) return;
    window.clearInterval(panelRefreshTimer);
    panelRefreshTimer = null;
  }

  function schedulePanelRender(): void {
    if (!panelOpen || panelRenderQueued || isEditingPanelField()) return;
    panelRenderQueued = true;
    window.setTimeout(() => {
      panelRenderQueued = false;
      if (panelOpen) renderPanel();
    }, 120);
  }

  function isEditingPanelField(): boolean {
    const active = shadow?.activeElement as HTMLElement | null;
    return !!active && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName);
  }

  function rememberDiagnosticEvent(event: LiveDiagnosticEvent): void {
    if (!event?.id) return;
    const index = liveEvents.findIndex((item) => item.id === event.id);
    if (index >= 0) {
      liveEvents[index] = event;
    } else {
      liveEvents.push(event);
    }
    liveEvents = liveEvents.sort((a, b) => a.timestamp - b.timestamp).slice(-220);
  }

  function mergeSessionEvents(events: LiveDiagnosticEvent[]): void {
    events.forEach((event) => rememberDiagnosticEvent(event));
  }

  function getProblemEvents(): LiveDiagnosticEvent[] {
    return liveEvents
      .filter((event) => {
        if (event.type === "performance" || event.type === "user-click") return false;
        if (event.type === "network") return event.severity === "error" || (typeof event.status === "number" && event.status >= 400);
        return event.severity === "error" || event.severity === "warning";
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function getNetworkEvents(): LiveDiagnosticEvent[] {
    return liveEvents.filter((event) => event.type === "network").sort((a, b) => b.timestamp - a.timestamp);
  }

  function eventTypeLabel(event: LiveDiagnosticEvent): string {
    const labels: Record<string, string> = {
      "js-error": "JS 错误",
      "unhandled-rejection": "Promise 异常",
      "console-error": "console.error",
      network: "请求异常",
      "resource-error": "资源失败"
    };
    return labels[event.type] ?? event.type;
  }

  function summarizeNetworkData(event: LiveDiagnosticEvent): string {
    const body = event.responseBody || event.requestBody || "";
    if (body) return summarizePayload(body);
    const contentType = typeof event.metadata?.contentType === "string" ? event.metadata.contentType : "";
    const source = typeof event.metadata?.source === "string" ? event.metadata.source : "network";
    return [contentType, source, typeof event.duration === "number" ? `${event.duration}ms` : ""].filter(Boolean).join(" / ") || "未采集响应体";
  }

  function summarizePayload(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "空数据";
    try {
      const json = JSON.parse(trimmed);
      if (Array.isArray(json)) {
        const first = json[0] && typeof json[0] === "object" ? Object.keys(json[0]).slice(0, 5).join(", ") : "";
        return `数组 ${json.length} 项${first ? ` / ${first}` : ""}`;
      }
      if (json && typeof json === "object") {
        return `对象字段 / ${Object.keys(json).slice(0, 8).join(", ")}`;
      }
      return truncate(String(json), 160);
    } catch {
      return truncate(trimmed.replace(/\s+/g, " "), 180);
    }
  }

  function formatNetworkStatus(event: LiveDiagnosticEvent): string {
    const status = typeof event.status === "number" ? String(event.status) : event.severity;
    const duration = typeof event.duration === "number" ? `${event.duration}ms` : "";
    return [status, duration].filter(Boolean).join(" / ");
  }

  function formatUrl(value: string): string {
    if (!value) return "unknown";
    try {
      const url = new URL(value, location.href);
      return truncate(`${url.pathname}${url.search}`, 96);
    } catch {
      return truncate(value, 96);
    }
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
  }

  function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}...`;
  }

  function getPageContext(): Record<string, unknown> {
    return {
      url: location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      startedAt: Date.now()
    };
  }

  function inputRow(prop: string, label: string, value: string, type = "text"): string {
    return `
      <label class="row">
        <span>${label}</span>
        <input data-prop="${prop}" type="${type}" value="${escapeHtml(value)}" />
      </label>
    `;
  }

  function selectRow(prop: string, label: string, value: string, options: string[]): string {
    return `
      <label class="row">
        <span>${label}</span>
        <select data-prop="${prop}">
          ${options.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function buildSelector(element: HTMLElement): string {
    if (element.id && /^[A-Za-z][\w-]*$/.test(element.id)) {
      return `#${CSS.escape(element.id)}`;
    }

    const dataSelector = ["data-testid", "data-test", "data-cy", "name", "aria-label"]
      .map((attr) => {
        const value = element.getAttribute(attr);
        return value ? `[${attr}="${cssAttrEscape(value)}"]` : "";
      })
      .find(Boolean);
    if (dataSelector) return `${element.tagName.toLowerCase()}${dataSelector}`;

    const parts: string[] = [];
    let node: HTMLElement | null = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const classNames = Array.from(node.classList)
        .filter((name) => !/^(hover|focus|active|selected|open|ng-|v-|css-|__[a-z0-9])/i.test(name))
        .slice(0, 2);
      if (classNames.length > 0) {
        part += `.${classNames.map((name) => CSS.escape(name)).join(".")}`;
      } else {
        const index = nthOfType(node);
        if (index > 1) {
          part += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function buildDomPath(element: HTMLElement): string {
    const parts: string[] = [];
    let node: HTMLElement | null = element;
    while (node && node !== document.documentElement && parts.length < 8) {
      parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}`);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function buildElementLocator(element: HTMLElement, selector: string, domPath: string): ElementLocator {
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || "",
      classList: Array.from(element.classList),
      attributes: collectLocatorAttributes(element),
      openingTag: buildOpeningTag(element),
      outerHTMLSnippet: truncateText(element.outerHTML.replace(/\s+/g, " "), 900),
      selector,
      domPath,
      parentChain: buildParentChain(element),
      matchedCssRules: collectMatchedCssRules(element)
    };
  }

  function collectLocatorAttributes(element: HTMLElement): Record<string, string> {
    const priority = new Set([
      "id",
      "class",
      "role",
      "aria-label",
      "aria-labelledby",
      "aria-describedby",
      "data-testid",
      "data-test",
      "data-cy",
      "name",
      "type",
      "href",
      "src",
      "alt",
      "title",
      "placeholder"
    ]);
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(element.attributes)) {
      if (!priority.has(attr.name) && !attr.name.startsWith("data-")) continue;
      attributes[attr.name] = truncateText(attr.value, 220);
      if (Object.keys(attributes).length >= 24) break;
    }
    return attributes;
  }

  function buildOpeningTag(element: HTMLElement): string {
    const attrs = Array.from(element.attributes)
      .filter((attr) => attr.name !== "style")
      .slice(0, 16)
      .map((attr) => `${attr.name}="${truncateText(attr.value, 180)}"`)
      .join(" ");
    return `<${element.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ""}>`;
  }

  function buildParentChain(element: HTMLElement): ElementAncestor[] {
    const chain: ElementAncestor[] = [];
    let node = element.parentElement;
    while (node && node !== document.documentElement && chain.length < 6) {
      chain.push({
        tagName: node.tagName.toLowerCase(),
        id: node.id || "",
        classList: Array.from(node.classList),
        selector: compactElementSelector(node)
      });
      node = node.parentElement;
    }
    return chain;
  }

  function compactElementSelector(element: HTMLElement): string {
    const classList = Array.from(element.classList).slice(0, 4);
    return `${element.tagName.toLowerCase()}${element.id ? `#${CSS.escape(element.id)}` : ""}${classList.length ? `.${classList.map((name) => CSS.escape(name)).join(".")}` : ""}`;
  }

  function collectMatchedCssRules(element: HTMLElement): MatchedCssRule[] {
    const matches: MatchedCssRule[] = [];
    const visitRules = (rules: CSSRuleList, source: string, condition?: string) => {
      for (const rule of Array.from(rules)) {
        if (matches.length >= 16) return;
        if (rule instanceof CSSStyleRule) {
          if (safeMatches(element, rule.selectorText)) {
            matches.push({
              selectorText: rule.selectorText,
              style: truncateText(rule.style.cssText, 520),
              source,
              condition
            });
          }
          continue;
        }
        if ("cssRules" in rule) {
          const nested = rule as CSSMediaRule | CSSSupportsRule;
          const nextCondition = "conditionText" in nested ? nested.conditionText : condition;
          visitRules(nested.cssRules, source, nextCondition || condition);
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      if (matches.length >= 16) break;
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      visitRules(rules, stylesheetSource(sheet));
    }
    return matches;
  }

  function safeMatches(element: HTMLElement, selectorText: string): boolean {
    try {
      return element.matches(selectorText);
    } catch {
      return false;
    }
  }

  function stylesheetSource(sheet: CSSStyleSheet): string {
    if (sheet.href) return sheet.href;
    const owner = sheet.ownerNode instanceof Element ? sheet.ownerNode : null;
    if (!owner) return "inline stylesheet";
    const id = owner.id ? `#${owner.id}` : "";
    const dataAttrs = Array.from(owner.attributes)
      .filter((attr) => attr.name.startsWith("data-"))
      .slice(0, 2)
      .map((attr) => `[${attr.name}="${truncateText(attr.value, 80)}"]`)
      .join("");
    return `${owner.tagName.toLowerCase()}${id}${dataAttrs}`;
  }

  function nthOfType(element: HTMLElement): number {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === element.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function labelElement(element: HTMLElement): string {
    const className = Array.from(element.classList).slice(0, 2).join(".");
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${className ? `.${className}` : ""}`;
  }

  function textSnippet(element: HTMLElement): string {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140);
  }

  function canEditTextContent(element: HTMLElement): boolean {
    const blockedTags = new Set(["SCRIPT", "STYLE", "LINK", "META", "IFRAME", "CANVAS", "SVG", "IMG", "VIDEO", "AUDIO", "OBJECT"]);
    if (blockedTags.has(element.tagName)) return false;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return false;
    if (element.closest("[contenteditable='false']")) return false;
    return editableTextValue(element).trim().length > 0 || currentChange?.textAfter !== undefined;
  }

  function editableTextValue(element: HTMLElement): string {
    return (element.innerText || element.textContent || "").replace(/\u00a0/g, " ");
  }

  function focusEditableElement(element: HTMLElement): void {
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function truncateText(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max)}...`;
  }

  function cssBlock(styles: Record<string, string>): string {
    const entries = Object.entries(styles).filter(([, value]) => value);
    if (entries.length === 0) return "/* 暂无修改 */";
    return entries.map(([key, value]) => `${key}: ${value};`).join("\n");
  }

  function toHexColor(value: string): string {
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return "#000000";
    return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  }

  function normalizeFontWeight(value: string): string {
    if (/^\d+$/.test(value)) return value;
    if (value === "bold") return "700";
    if (value === "normal") return "400";
    return "400";
  }

  function cssAttrEscape(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[char];
    });
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  function toast(message: string): void {
    if (!shadow) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    shadow.appendChild(node);
    window.setTimeout(() => node.remove(), 1800);
  }

  function launcherIcon(type: "select" | "panel"): string {
    if (type === "select") {
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 4l8 16 1.9-6.1L21 12 5 4z" />
          <path d="M13.8 13.8l4.4 4.4" />
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M9 5v14" />
        <path d="M12.5 9h4.5" />
        <path d="M12.5 13h4.5" />
      </svg>
    `;
  }

  function bindLauncherEvents(): void {
    if (!launcherDock) return;
    const launcher = launcherDock.querySelector<HTMLButtonElement>(".devlite-launcher");
    const hitArea = launcherDock.querySelector<HTMLDivElement>(".launcher-hit-area");
    const actionButtons = Array.from(launcherDock.querySelectorAll<HTMLButtonElement>("[data-launcher-action]"));
    launcherDock.addEventListener("pointerenter", () => setLauncherExpanded(true));
    launcherDock.addEventListener("pointerleave", scheduleLauncherCollapse);
    launcherDock.addEventListener("focusin", () => setLauncherExpanded(true));
    launcherDock.addEventListener("focusout", scheduleLauncherCollapse);
    [launcher, hitArea, ...actionButtons].forEach((node) => {
      node?.addEventListener("pointerenter", () => setLauncherExpanded(true));
      node?.addEventListener("pointerleave", scheduleLauncherCollapse);
    });
    launcher?.addEventListener("pointerdown", startLauncherDrag);
    launcher?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (suppressLauncherClick) {
        suppressLauncherClick = false;
        return;
      }
      openPanel();
    });

    actionButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.launcherAction;
        if (action === "select") {
          setLauncherExpanded(false);
          startInspector();
          toast("点击页面元素完成定位");
          return;
        }
        setLauncherExpanded(false);
        openPanel();
      });
    });
  }

  function setLauncherExpanded(expanded: boolean): void {
    if (!launcherDock) return;
    if (launcherCollapseTimer !== null) {
      window.clearTimeout(launcherCollapseTimer);
      launcherCollapseTimer = null;
    }
    launcherDock.classList.toggle("expanded", expanded);
  }

  function scheduleLauncherCollapse(): void {
    if (!launcherDock) return;
    if (launcherDock.matches(":focus-within")) return;
    if (launcherCollapseTimer !== null) {
      window.clearTimeout(launcherCollapseTimer);
    }
    launcherCollapseTimer = window.setTimeout(() => {
      launcherDock?.classList.remove("expanded");
      launcherCollapseTimer = null;
    }, 220);
  }

  function applyLauncherPosition(): void {
    if (!launcherDock) return;
    const minTop = Math.min(74, Math.max(36, window.innerHeight / 2));
    const maxTop = Math.max(minTop, window.innerHeight - minTop);
    launcherTop = Math.min(Math.max(minTop, launcherTop), maxTop);
    launcherDock.style.top = `${launcherTop}px`;
  }

  function startLauncherDrag(event: PointerEvent): void {
    if (!launcherDock) return;
    event.preventDefault();
    event.stopPropagation();
    const launcher = event.currentTarget as HTMLButtonElement;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startTop = launcherTop;
    let moved = false;

    launcher.setPointerCapture(pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      if (Math.abs(delta) > 3) moved = true;
      launcherTop = startTop + delta;
      applyLauncherPosition();
    };

    const onUp = () => {
      suppressLauncherClick = moved;
      if (launcher.hasPointerCapture(pointerId)) {
        launcher.releasePointerCapture(pointerId);
      }
      launcher.removeEventListener("pointermove", onMove);
      launcher.removeEventListener("pointerup", onUp);
      launcher.removeEventListener("pointercancel", onUp);
    };

    launcher.addEventListener("pointermove", onMove);
    launcher.addEventListener("pointerup", onUp);
    launcher.addEventListener("pointercancel", onUp);
  }

  function applyPanelPosition(): void {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height || 80, window.innerHeight - 16) - 8);
    const maxRight = Math.max(8, window.innerWidth - 80);
    panelPosition = {
      right: Math.min(Math.max(8, panelPosition.right), maxRight),
      top: Math.min(Math.max(8, panelPosition.top), maxTop)
    };
    panel.style.right = `${panelPosition.right}px`;
    panel.style.top = `${panelPosition.top}px`;
  }

  function startPanelDrag(event: PointerEvent): void {
    if (!panel) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button")) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const pointerId = event.pointerId;
    panel.setPointerCapture(pointerId);
    panel.classList.add("dragging");

    const onMove = (moveEvent: PointerEvent) => {
      const nextLeft = Math.min(Math.max(8, moveEvent.clientX - offsetX), Math.max(8, window.innerWidth - rect.width - 8));
      const nextTop = Math.min(Math.max(8, moveEvent.clientY - offsetY), Math.max(8, window.innerHeight - rect.height - 8));
      panelPosition = {
        right: Math.max(8, window.innerWidth - nextLeft - rect.width),
        top: nextTop
      };
      applyPanelPosition();
    };

    const onUp = () => {
      if (panel?.hasPointerCapture(pointerId)) {
        panel.releasePointerCapture(pointerId);
      }
      panel?.classList.remove("dragging");
      panel?.removeEventListener("pointermove", onMove);
      panel?.removeEventListener("pointerup", onUp);
      panel?.removeEventListener("pointercancel", onUp);
    };

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
  }

  function isOverlayEvent(event: Event): boolean {
    const target = event.target as Node | null;
    return !!target && isOverlayNode(target);
  }

  function isOverlayNode(node: Node): boolean {
    return !!overlayHost && (node === overlayHost || overlayHost.contains(node));
  }

  function randomId(): string {
    return crypto.randomUUID ? crypto.randomUUID() : `devlite-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function overlayStyles(): string {
    return `
      :host { all: initial; }
      .devlite-highlighter {
        position: fixed;
        top: 0;
        left: 0;
        display: none;
        box-sizing: border-box;
        border: 2px solid #1f7a5c;
        background: rgba(31, 122, 92, 0.08);
        color: #0f2f25;
        font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 0;
        pointer-events: none;
        box-shadow: 0 0 0 1px rgba(255,255,255,.9), 0 10px 30px rgba(15,47,37,.18);
      }
      .devlite-panel {
        position: fixed;
        right: 16px;
        top: 16px;
        width: min(760px, calc(100vw - 32px));
        height: min(560px, calc(100dvh - 32px));
        min-width: min(360px, calc(100vw - 32px));
        min-height: 280px;
        max-width: calc(100vw - 32px);
        max-height: calc(100dvh - 32px);
        overflow: hidden;
        resize: both;
        pointer-events: auto;
        box-sizing: border-box;
        border: 1px solid #d6d8d2;
        border-radius: 8px;
        background: #fbfbf8;
        color: #161815;
        box-shadow: 0 24px 80px rgba(22,24,21,.22);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .devlite-panel[hidden] { display: none; }
      .style-editor-popover {
        position: fixed;
        left: 0;
        top: 0;
        width: min(320px, calc(100vw - 16px));
        max-height: min(520px, calc(100dvh - 16px));
        overflow: auto;
        pointer-events: auto;
        box-sizing: border-box;
        border: 1px solid #d6d8d2;
        border-radius: 8px;
        background: #fbfbf8;
        color: #161815;
        box-shadow: 0 18px 58px rgba(22,24,21,.22);
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .style-editor-popover[hidden] { display: none; }
      .style-editor-head {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px;
        border-bottom: 1px solid #e4e5df;
        background: #fbfbf8;
      }
      .style-editor-head strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
      }
      .style-editor-popover > .rows {
        padding: 10px;
      }
      .style-editor-popover .row {
        grid-template-columns: 58px minmax(0, 1fr);
      }
      .style-editor-details {
        border-top: 1px solid #eceee7;
      }
      .style-editor-details summary {
        padding: 9px 10px;
        cursor: pointer;
        color: #27483b;
        font-weight: 600;
        user-select: none;
      }
      .style-editor-details .rows {
        padding: 0 10px 10px;
      }
      .style-editor-actions {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
        gap: 8px;
        padding: 10px;
        border-top: 1px solid #eceee7;
      }
      .devlite-dock {
        position: fixed;
        right: 0;
        top: 50%;
        width: 112px;
        height: 148px;
        transform: translateY(-50%);
        pointer-events: none;
      }
      .launcher-hit-area {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .devlite-dock.expanded .launcher-hit-area {
        pointer-events: auto;
      }
      .launcher-actions {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .devlite-dock.expanded .launcher-actions,
      .devlite-dock:focus-within .launcher-actions {
        pointer-events: auto;
      }
      .launcher-action {
        position: absolute;
        right: 48px;
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        padding: 0;
        border-radius: 50%;
        color: #163d31;
        opacity: 0;
        pointer-events: none;
        box-shadow: 0 10px 28px rgba(22,24,21,.18);
        transform: translate(18px, 0) scale(.86);
        transition: opacity 170ms ease, transform 170ms ease, background 160ms ease, border-color 160ms ease, color 160ms ease;
      }
      .launcher-action[data-launcher-action="select"] {
        top: 22px;
        transform: translate(20px, 18px) scale(.86);
      }
      .launcher-action[data-launcher-action="panel"] {
        bottom: 22px;
        transform: translate(20px, -18px) scale(.86);
      }
      .devlite-dock.expanded .launcher-action,
      .devlite-dock:focus-within .launcher-action {
        opacity: 1;
        pointer-events: auto;
        transform: translate(0, 0) scale(1);
      }
      .launcher-action svg {
        display: block;
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.9;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .devlite-launcher {
        position: absolute;
        right: 0;
        top: 50%;
        width: 42px;
        height: 52px;
        transform: translateY(-50%);
        pointer-events: auto;
        box-sizing: border-box;
        border: 1px solid #cdd4ca;
        border-right: 0;
        border-radius: 8px 0 0 8px;
        background: #fbfbf8;
        color: #163d31;
        box-shadow: 0 12px 40px rgba(22,24,21,.20);
        cursor: pointer;
        touch-action: none;
        transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
      }
      .devlite-launcher:hover {
        border-color: #1f7a5c;
        background: #f4f8f3;
      }
      .devlite-launcher:active { transform: translateY(-50%) scale(.98); }
      .devlite-launcher img {
        display: block;
        width: 30px;
        height: 30px;
        margin: 10px 5px 10px 7px;
        pointer-events: none;
      }
      .panel-shell {
        display: grid;
        grid-template-columns: 154px minmax(0, 1fr);
        height: 100%;
        min-height: 0;
      }
      .panel-sidebar {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
        padding: 12px;
        box-sizing: border-box;
        background: #f0f2ec;
        border-right: 1px solid #dfe2d9;
        cursor: move;
      }
      .panel-brand strong {
        display: block;
        color: #151713;
        font-size: 14px;
      }
      .panel-brand {
        display: flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
      }
      .panel-brand img {
        width: 30px;
        height: 30px;
        flex: 0 0 auto;
      }
      .panel-brand span {
        display: block;
        margin-top: 2px;
        color: #697064;
        font-size: 12px;
      }
      .panel-nav {
        display: grid;
        gap: 6px;
      }
      .nav-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        min-width: 0;
        text-align: left;
        border-color: transparent;
        background: transparent;
      }
      .nav-item span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nav-item strong {
        min-width: 20px;
        height: 18px;
        border-radius: 5px;
        background: #d34836;
        color: #fff;
        font-size: 11px;
        line-height: 18px;
        text-align: center;
      }
      .nav-item.active {
        background: #ffffff;
        border-color: #cfd6ca;
        color: #163d31;
      }
      .sidebar-spacer { flex: 1; }
      .config-button {
        width: 100%;
        font-weight: 600;
      }
      .panel-main {
        display: flex;
        min-width: 0;
        min-height: 0;
        flex-direction: column;
      }
      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px;
        border-bottom: 1px solid #e4e5df;
        cursor: move;
        user-select: none;
      }
      .devlite-panel.dragging { user-select: none; }
      .panel-header strong { display:block; font-size: 14px; letter-spacing: 0; }
      .panel-header span { display:block; color:#676b62; font-size:12px; }
      .panel-content {
        min-height: 0;
        overflow: auto;
        padding: 12px;
      }
      .empty {
        padding: 16px 12px;
        color:#4b5047;
        background: #f6f7f3;
        border-radius: 8px;
      }
      .empty.compact { padding: 12px; }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }
      .target {
        display:grid;
        grid-template-columns: 1fr auto;
        align-items:center;
        gap:8px;
        padding:10px;
        margin-bottom: 8px;
        border:1px solid #e8e9e3;
        border-radius: 8px;
        background: #fff;
      }
      .style-record-list {
        display: grid;
        gap: 8px;
      }
      .style-record {
        padding: 10px;
        border: 1px solid #e2e4dc;
        border-radius: 8px;
        background: #fff;
      }
      .style-record-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .style-record-head strong {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #151713;
      }
      .style-record-head span {
        flex: 0 0 auto;
        color: #697064;
        font-size: 12px;
      }
      .style-record code {
        display: block;
        margin-top: 6px;
      }
      .style-record p {
        margin: 7px 0 0;
        color: #333a31;
      }
      code {
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        color:#27483b;
      }
      pre {
        max-height: 132px;
        overflow: auto;
        margin: 8px 0 0;
        padding: 8px;
        border-radius: 6px;
        background: #f4f5f1;
        color: #30352e;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: pre-wrap;
      }
      .rows { display:grid; gap:7px; }
      .row {
        display:grid;
        grid-template-columns: 86px 1fr;
        align-items:center;
        gap:10px;
      }
      .row span { color:#4d524a; }
      input, select, textarea {
        min-width:0;
        box-sizing:border-box;
        border:1px solid #d7d9d1;
        border-radius:6px;
        background:#fff;
        color:#151713;
        padding:0 8px;
        font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      input, select { height:30px; }
      input[type="color"] { padding:2px; }
      textarea {
        min-height: 74px;
        resize: vertical;
        padding: 8px;
        line-height: 1.45;
      }
      .text-editor {
        display: grid;
        gap: 8px;
        padding: 10px;
        margin-bottom: 8px;
        border: 1px solid #e8e9e3;
        border-radius: 8px;
        background: #fff;
      }
      .text-row {
        display: grid;
        grid-template-columns: 86px minmax(0, 1fr);
        align-items: start;
        gap: 10px;
      }
      .text-row span {
        padding-top: 7px;
        color:#4d524a;
      }
      .text-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      button {
        height:30px;
        border:1px solid #cfd2c9;
        border-radius:6px;
        background:#fff;
        color:#1f241d;
        padding:0 10px;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor:pointer;
        transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
      }
      button:hover { border-color:#1f7a5c; color:#124333; }
      button:focus-visible {
        outline: 2px solid rgba(31,122,92,.32);
        outline-offset: 2px;
      }
      button:active { transform: scale(.98); }
      .primary {
        background:#1f7a5c;
        border-color:#1f7a5c;
        color:#fff;
      }
      .primary:hover { color:#fff; background:#185f49; }
      .actions {
        display:grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap:8px;
        padding-top:12px;
      }
      .actions button { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .icon-button { white-space:nowrap; }
      .diagnostic-list,
      .network-list {
        display: grid;
        gap: 8px;
      }
      .issue,
      .network-item {
        padding: 10px;
        border: 1px solid #e2e4dc;
        border-radius: 8px;
        background: #fff;
      }
      .issue.error,
      .network-item.error {
        border-color: rgba(211,72,54,.38);
      }
      .issue.warning,
      .network-item.warning {
        border-color: rgba(169,112,34,.38);
      }
      .issue-head,
      .network-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .issue-head strong,
      .network-line strong {
        color: #151713;
      }
      .issue-head span,
      .network-line span {
        flex: 0 0 auto;
        margin-left: auto;
        color: #697064;
        font-size: 12px;
      }
      .issue p,
      .network-item p {
        margin: 7px 0 0;
        color: #333a31;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }
      .issue code,
      .network-line code {
        min-width: 0;
      }
      .network-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }
      .network-summary div {
        padding: 10px;
        border-radius: 8px;
        background: #f6f7f3;
      }
      .network-summary strong {
        display: block;
        color: #151713;
        font-size: 18px;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
      .network-summary span {
        color: #697064;
        font-size: 12px;
      }
      .toast {
        position:fixed;
        right:18px;
        bottom:18px;
        background:#151713;
        color:#fff;
        border-radius:6px;
        padding:8px 10px;
        pointer-events:none;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (max-width: 560px) {
        .devlite-panel {
          right: 8px !important;
          width: calc(100vw - 16px);
        }
        .panel-shell {
          grid-template-columns: 1fr;
        }
        .panel-sidebar {
          flex-direction: row;
          align-items: center;
          overflow: auto;
          border-right: 0;
          border-bottom: 1px solid #dfe2d9;
        }
        .panel-brand,
        .sidebar-spacer {
          display: none;
        }
        .panel-nav {
          display: flex;
          flex: 1 1 auto;
        }
        .nav-item,
        .config-button {
          width: auto;
          flex: 0 0 auto;
        }
        .row {
          grid-template-columns: 72px 1fr;
        }
        .text-row {
          grid-template-columns: 72px minmax(0, 1fr);
        }
        .actions,
        .network-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `;
  }
})();
