import { clampFloatingPosition, pickStyleEditorPosition } from "./floatingPosition";
import type { FloatingPosition } from "./types";

export class StyleEditorPositionController {
  private position: FloatingPosition | null = null;

  reset(): void {
    this.position = null;
  }

  update(editor: HTMLElement | null, element: HTMLElement | null): void {
    if (!editor || editor.hidden || !element) return;
    const rect = element.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const width = editorRect.width || 300;
    const height = editorRect.height || 240;
    const nextPosition = this.position?.manual
      ? clampFloatingPosition(this.position.left, this.position.top, width, height)
      : pickStyleEditorPosition(rect, width, height);
    this.position = {
      ...nextPosition,
      manual: this.position?.manual ?? false
    };
    this.apply(editor, nextPosition);
  }

  startDrag(editor: HTMLElement | null, event: PointerEvent): void {
    if (!editor) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,input,select,textarea,summary")) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = editor.getBoundingClientRect();
    const pointerId = event.pointerId;
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    editor.setPointerCapture(pointerId);
    editor.classList.add("dragging");
    let frameId: number | null = null;
    let pendingPosition = {
      left: rect.left,
      top: rect.top
    };
    const flushPosition = () => {
      frameId = null;
      this.apply(editor, pendingPosition);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const editorRect = editor.getBoundingClientRect();
      const next = clampFloatingPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY, editorRect.width, editorRect.height);
      this.position = { ...next, manual: true };
      pendingPosition = next;
      if (frameId === null) {
        frameId = window.requestAnimationFrame(flushPosition);
      }
    };

    const onUp = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        flushPosition();
      }
      if (editor.hasPointerCapture(pointerId)) {
        editor.releasePointerCapture(pointerId);
      }
      editor.classList.remove("dragging");
      editor.removeEventListener("pointermove", onMove);
      editor.removeEventListener("pointerup", onUp);
      editor.removeEventListener("pointercancel", onUp);
    };

    editor.addEventListener("pointermove", onMove);
    editor.addEventListener("pointerup", onUp);
    editor.addEventListener("pointercancel", onUp);
  }

  private apply(editor: HTMLElement, position: Pick<FloatingPosition, "left" | "top">): void {
    editor.style.left = `${Math.round(position.left)}px`;
    editor.style.top = `${Math.round(position.top)}px`;
  }
}
