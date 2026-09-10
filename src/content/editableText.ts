import { composedParent, documentOf, elementText, isHtmlElement, windowOf, type InspectableElement } from "./domContext";

const BLOCKED_EDIT_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "IFRAME", "CANVAS", "SVG", "IMG", "VIDEO", "AUDIO", "OBJECT"]);

export function canEditTextContent(element: InspectableElement, hasEditedText = false): element is HTMLElement {
  if (!isHtmlElement(element)) return false;
  if (BLOCKED_EDIT_TAGS.has(element.tagName)) return false;
  if (["input", "textarea", "select"].includes(element.localName)) return false;
  for (let ancestor: Element | null = element; ancestor; ancestor = composedParent(ancestor)) {
    if (ancestor.getAttribute("contenteditable") === "false") return false;
  }
  // Existing rich-text editors own their selection and composition state.
  if (element.isContentEditable && !hasEditedText) return false;
  return editableTextValue(element).trim().length > 0 || hasEditedText;
}

export function editableTextValue(element: InspectableElement): string {
  return elementText(element).replace(/\u00a0/g, " ");
}

export function focusEditableElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  const selection = windowOf(element).getSelection();
  if (!selection) return;
  const range = documentOf(element).createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
