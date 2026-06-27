type PanelPosition = {
  left: number | null;
  top: number;
  width?: number;
  height?: number;
};

const PANEL_POSITION_STORAGE_KEY = "devlite.panel.position";
const PANEL_EDGE_GAP = 16;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 280;

export const DEFAULT_PANEL_WIDTH = 920;
export const DEFAULT_PANEL_HEIGHT = 680;

type PanelViewport = {
  width: number;
  height: number;
};

export class PanelPositionController {
  private position: PanelPosition = loadPanelPosition();

  apply(panel: HTMLElement | null): void {
    if (!panel) return;
    const viewport = currentViewport();
    const size = resolvePanelSize(this.position, viewport);
    panel.style.width = `${size.width}px`;
    panel.style.height = `${size.height}px`;
    const rect = panel.getBoundingClientRect();
    const width = rect.width || size.width;
    const height = rect.height || size.height;
    const maxLeft = Math.max(PANEL_EDGE_GAP, viewport.width - width - PANEL_EDGE_GAP);
    const maxTop = Math.max(PANEL_EDGE_GAP, viewport.height - height - PANEL_EDGE_GAP);
    const initialLeft = Math.max(PANEL_EDGE_GAP, viewport.width - width - PANEL_EDGE_GAP);
    this.position = {
      ...this.position,
      left: Math.min(Math.max(PANEL_EDGE_GAP, this.position.left ?? initialLeft), maxLeft),
      top: Math.min(Math.max(PANEL_EDGE_GAP, this.position.top), maxTop)
    };
    panel.style.left = `${this.position.left}px`;
    panel.style.right = "auto";
    panel.style.top = `${this.position.top}px`;
  }

  startDrag(panel: HTMLElement | null, event: PointerEvent, onEnd?: () => void): void {
    if (!panel) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button, input, select, textarea, summary, [data-panel-resize]")) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const pointerId = event.pointerId;
    panel.setPointerCapture(pointerId);
    panel.classList.add("dragging");
    const maxLeft = Math.max(PANEL_EDGE_GAP, window.innerWidth - rect.width - PANEL_EDGE_GAP);
    const maxTop = Math.max(PANEL_EDGE_GAP, window.innerHeight - rect.height - PANEL_EDGE_GAP);
    let frameId: number | null = null;
    let pendingLeft = rect.left;
    let pendingTop = rect.top;
    const applyPosition = () => {
      frameId = null;
      panel.style.left = `${pendingLeft}px`;
      panel.style.right = "auto";
      panel.style.top = `${pendingTop}px`;
    };
    const schedulePosition = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(applyPosition);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const nextLeft = Math.min(Math.max(PANEL_EDGE_GAP, moveEvent.clientX - offsetX), maxLeft);
      const nextTop = Math.min(Math.max(PANEL_EDGE_GAP, moveEvent.clientY - offsetY), maxTop);
      this.position = {
        ...this.position,
        left: nextLeft,
        top: nextTop
      };
      pendingLeft = nextLeft;
      pendingTop = nextTop;
      schedulePosition();
    };

    const onUp = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        applyPosition();
      }
      if (panel.hasPointerCapture(pointerId)) {
        panel.releasePointerCapture(pointerId);
      }
      panel.classList.remove("dragging");
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerup", onUp);
      panel.removeEventListener("pointercancel", onUp);
      savePanelPosition(this.position);
      onEnd?.();
    };

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
  }

  startResize(panel: HTMLElement | null, event: PointerEvent, onEnd?: () => void): void {
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    panel.setPointerCapture(pointerId);
    panel.classList.add("resizing");
    const maxWidth = Math.max(0, window.innerWidth - rect.left - PANEL_EDGE_GAP);
    const maxHeight = Math.max(0, window.innerHeight - rect.top - PANEL_EDGE_GAP);
    const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
    let frameId: number | null = null;
    let pendingWidth = rect.width;
    let pendingHeight = rect.height;
    const applySize = () => {
      frameId = null;
      panel.style.width = `${pendingWidth}px`;
      panel.style.height = `${pendingHeight}px`;
    };
    const updatePendingSize = (width: number, height: number) => {
      pendingWidth = Math.round(width);
      pendingHeight = Math.round(height);
      this.position = {
        ...this.position,
        width: pendingWidth,
        height: pendingHeight
      };
    };
    const scheduleSize = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(applySize);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(Math.max(minWidth, rect.width + moveEvent.clientX - startX), maxWidth);
      const nextHeight = Math.min(Math.max(minHeight, rect.height + moveEvent.clientY - startY), maxHeight);
      updatePendingSize(nextWidth, nextHeight);
      scheduleSize();
    };

    const onUp = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        applySize();
      }
      if (panel.hasPointerCapture(pointerId)) {
        panel.releasePointerCapture(pointerId);
      }
      panel.classList.remove("resizing");
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerup", onUp);
      panel.removeEventListener("pointercancel", onUp);
      this.apply(panel);
      savePanelPosition(this.position);
      onEnd?.();
    };

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
  }

}

export function resolvePanelSize(position: Pick<PanelPosition, "width" | "height">, viewport: PanelViewport): { width: number; height: number } {
  return {
    width: clampPanelWidth(position.width ?? DEFAULT_PANEL_WIDTH, viewport.width),
    height: clampPanelHeight(position.height ?? DEFAULT_PANEL_HEIGHT, viewport.height)
  };
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const maxWidth = Math.max(0, viewportWidth - PANEL_EDGE_GAP * 2);
  const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
  return Math.round(Math.min(Math.max(minWidth, width), maxWidth));
}

export function clampPanelHeight(height: number, viewportHeight: number): number {
  const maxHeight = Math.max(0, viewportHeight - PANEL_EDGE_GAP * 2);
  const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
  return Math.round(Math.min(Math.max(minHeight, height), maxHeight));
}

function currentViewport(): PanelViewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function loadPanelPosition(): PanelPosition {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_POSITION_STORAGE_KEY) || "null") as PanelPosition | null;
    if (!parsed || typeof parsed !== "object") return { left: null, top: 16 };
    return {
      left: typeof parsed.left === "number" ? parsed.left : null,
      top: typeof parsed.top === "number" ? parsed.top : 16,
      width: typeof parsed.width === "number" ? parsed.width : undefined,
      height: typeof parsed.height === "number" ? parsed.height : undefined
    };
  } catch {
    return { left: null, top: 16 };
  }
}

function savePanelPosition(position: PanelPosition): void {
  try {
    localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Some pages block storage access; panel still works with in-memory position.
  }
}
