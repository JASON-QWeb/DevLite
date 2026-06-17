import { focusEditableElement } from "./editableText";
import type { ContentTextKey } from "./i18n";

type InlineTextEditState = {
  element: HTMLElement;
  previousContentEditable: string | null;
  previousSpellcheck: string | null;
  onInput: () => void;
  onBlur: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
};

type InlineTextEditorOptions = {
  canEdit: (element: HTMLElement) => boolean;
  ensureBaseline: (element: HTMLElement) => void;
  isCurrentElement: (element: HTMLElement) => boolean;
  onChange: (element: HTMLElement) => void;
  onEscape: () => void;
  recordAfter: (element: HTMLElement) => void;
  t: (key: ContentTextKey) => string;
  toast: (message: string) => void;
};

export class InlineTextEditor {
  private state: InlineTextEditState | null = null;

  constructor(private readonly options: InlineTextEditorOptions) {}

  isActive(): boolean {
    return this.state !== null;
  }

  start(element: HTMLElement | null): void {
    if (!element || !this.options.canEdit(element)) {
      this.options.toast(this.options.t("noEditableText"));
      return;
    }

    if (this.state?.element === element) {
      focusEditableElement(element);
      return;
    }

    this.stop();
    this.options.ensureBaseline(element);

    const state: InlineTextEditState = {
      element,
      previousContentEditable: element.getAttribute("contenteditable"),
      previousSpellcheck: element.getAttribute("spellcheck"),
      onInput: () => {
        if (!this.options.isCurrentElement(element)) return;
        this.options.recordAfter(element);
        this.options.onChange(element);
      },
      onBlur: () => {
        this.stop();
      },
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          this.stop();
          this.options.onEscape();
        }
      },
      onPaste: (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return;
        event.preventDefault();
        document.execCommand("insertText", false, text);
      }
    };

    this.state = state;
    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute("spellcheck", "false");
    element.addEventListener("input", state.onInput);
    element.addEventListener("blur", state.onBlur);
    element.addEventListener("keydown", state.onKeydown);
    element.addEventListener("paste", state.onPaste);
    focusEditableElement(element);
    this.options.toast(this.options.t("inlineEditHint"));
  }

  stop(): void {
    const state = this.state;
    if (!state) return;
    state.element.removeEventListener("input", state.onInput);
    state.element.removeEventListener("blur", state.onBlur);
    state.element.removeEventListener("keydown", state.onKeydown);
    state.element.removeEventListener("paste", state.onPaste);
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
    this.state = null;
  }
}
