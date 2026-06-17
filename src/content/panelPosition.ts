type PanelPosition = {
  left: number | null;
  top: number;
};

export class PanelPositionController {
  private position: PanelPosition = { left: null, top: 16 };

  apply(panel: HTMLElement | null): void {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const width = Math.min(rect.width || 760, window.innerWidth - 16);
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height || 80, window.innerHeight - 16) - 8);
    const initialLeft = Math.max(8, window.innerWidth - width - 16);
    this.position = {
      left: Math.min(Math.max(8, this.position.left ?? initialLeft), maxLeft),
      top: Math.min(Math.max(8, this.position.top), maxTop)
    };
    panel.style.left = `${this.position.left}px`;
    panel.style.right = "auto";
    panel.style.top = `${this.position.top}px`;
    if (rect.width > window.innerWidth - 16) panel.style.width = `${window.innerWidth - 16}px`;
    if (rect.height > window.innerHeight - 16) panel.style.height = `${window.innerHeight - 16}px`;
  }

  startDrag(panel: HTMLElement | null, event: PointerEvent, onEnd?: () => void): void {
    if (!panel) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, summary, [data-panel-resize]")) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const pointerId = event.pointerId;
    panel.setPointerCapture(pointerId);
    panel.classList.add("dragging");
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
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
      const nextLeft = Math.min(Math.max(8, moveEvent.clientX - offsetX), maxLeft);
      const nextTop = Math.min(Math.max(8, moveEvent.clientY - offsetY), maxTop);
      this.position = {
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
    const maxWidth = Math.max(320, window.innerWidth - rect.left - 8);
    const maxHeight = Math.max(280, window.innerHeight - rect.top - 8);
    let frameId: number | null = null;
    let pendingWidth = rect.width;
    let pendingHeight = rect.height;
    const applySize = () => {
      frameId = null;
      panel.style.width = `${pendingWidth}px`;
      panel.style.height = `${pendingHeight}px`;
    };
    const scheduleSize = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(applySize);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(Math.max(320, rect.width + moveEvent.clientX - startX), maxWidth);
      const nextHeight = Math.min(Math.max(280, rect.height + moveEvent.clientY - startY), maxHeight);
      pendingWidth = nextWidth;
      pendingHeight = nextHeight;
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
      onEnd?.();
    };

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
  }
}
