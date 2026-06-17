const BLOCKED_EDIT_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "IFRAME", "CANVAS", "SVG", "IMG", "VIDEO", "AUDIO", "OBJECT"]);

export function canEditTextContent(element: HTMLElement, hasEditedText = false): boolean {
  if (BLOCKED_EDIT_TAGS.has(element.tagName)) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return false;
  if (element.closest("[contenteditable='false']")) return false;
  return editableTextValue(element).trim().length > 0 || hasEditedText;
}

export function editableTextValue(element: HTMLElement): string {
  return (element.innerText || element.textContent || "").replace(/\u00a0/g, " ");
}

export function focusEditableElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
