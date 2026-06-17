type PanelPosition = {
  right: number;
  top: number;
};

export class PanelPositionController {
  private position: PanelPosition = { right: 16, top: 16 };

  apply(panel: HTMLElement | null): void {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height || 80, window.innerHeight - 16) - 8);
    const maxRight = Math.max(8, window.innerWidth - 80);
    this.position = {
      right: Math.min(Math.max(8, this.position.right), maxRight),
      top: Math.min(Math.max(8, this.position.top), maxTop)
    };
    panel.style.right = `${this.position.right}px`;
    panel.style.top = `${this.position.top}px`;
  }

  startDrag(panel: HTMLElement | null, event: PointerEvent): void {
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
      this.position = {
        right: Math.max(8, window.innerWidth - nextLeft - rect.width),
        top: nextTop
      };
      this.apply(panel);
    };

    const onUp = () => {
      if (panel.hasPointerCapture(pointerId)) {
        panel.releasePointerCapture(pointerId);
      }
      panel.classList.remove("dragging");
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerup", onUp);
      panel.removeEventListener("pointercancel", onUp);
    };

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerup", onUp);
    panel.addEventListener("pointercancel", onUp);
  }
}
