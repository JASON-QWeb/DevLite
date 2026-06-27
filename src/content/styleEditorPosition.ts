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
    if (target?.closest("button,input,select,textarea,summary,[data-style-editor-resize]")) return;
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

  startResize(editor: HTMLElement | null, event: PointerEvent): void {
    if (!editor) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = editor.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const minWidth = Math.min(280, Math.max(240, window.innerWidth - 16));
    const minHeight = Math.min(260, Math.max(220, window.innerHeight - 16));
    const maxWidth = Math.max(minWidth, window.innerWidth - rect.left - 8);
    const maxHeight = Math.max(minHeight, window.innerHeight - rect.top - 8);
    let frameId: number | null = null;
    let pendingWidth = rect.width;
    let pendingHeight = rect.height;
    const applySize = () => {
      frameId = null;
      editor.style.width = `${Math.round(pendingWidth)}px`;
      editor.style.height = `${Math.round(pendingHeight)}px`;
    };
    const scheduleSize = () => {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(applySize);
      }
    };

    editor.setPointerCapture(pointerId);
    editor.classList.add("resizing");

    const onMove = (moveEvent: PointerEvent) => {
      pendingWidth = Math.min(Math.max(minWidth, rect.width + moveEvent.clientX - startX), maxWidth);
      pendingHeight = Math.min(Math.max(minHeight, rect.height + moveEvent.clientY - startY), maxHeight);
      scheduleSize();
    };

    const onUp = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        applySize();
      }
      if (editor.hasPointerCapture(pointerId)) {
        editor.releasePointerCapture(pointerId);
      }
      editor.classList.remove("resizing");
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
