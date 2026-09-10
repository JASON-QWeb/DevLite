import {
  applyStyleChange, createStyleChange, ensureDomChangeBaseline, ensureTextChangeBaseline,
  recordTextAfter, resolveChangeElement, restoreDeletedChange, undoStyleChange, forgetDomSnapshot, hasRecordedChange
} from "./changeManager";
import { canReplaceIcon, canReplaceImage, computedStyle, composedParent, isDevLiteNode, isInspectableElement, rootOf, type InspectableElement } from "./domContext";
import { buildElementAddress, fingerprint, matchesFingerprint } from "./elementAddress";
import { canEditTextContent } from "./editableText";
import { applyIconReplacement, applyImageReplacement } from "./imageReplacement";
import { InlineTextEditor } from "./inlineTextEditor";
import { EDITABLE_PROPS } from "./panelConfig";
import { verifyStyleChange } from "./styleVerification";
import type { RootRegistry } from "./rootRegistry";
import type { ContentTextKey } from "./i18n";
import type { ElementCommand, ElementSnapshot } from "../shared/elementCommands";
import type { ElementDocumentContext, ElementFingerprint, StyleChange } from "../shared/types";

type Entry = { change: StyleChange; element: InspectableElement | null; identity: ElementFingerprint; exportedElement?: InspectableElement | null };

export class ElementExecutor {
  private entries = new Map<string, Entry>();
  private selectedId: string | null = null;
  private editor: InlineTextEditor;

  constructor(private readonly options: {
    context: () => ElementDocumentContext;
    roots: RootRegistry;
    t: (key: ContentTextKey) => string;
    onSelected: (snapshot: ElementSnapshot) => void;
    onChanged: (snapshot: ElementSnapshot) => void;
    onHighlight: (element: InspectableElement | null) => void;
    onToast: (text: string) => void;
  }) {
    this.editor = new InlineTextEditor({
      canEdit: canEditTextContent,
      ensureBaseline: (element) => { const entry = this.selected(); if (entry) ensureTextChangeBaseline(entry.change, element); },
      isCurrentElement: (element) => this.selected()?.element === element,
      onChange: (element) => options.onHighlight(element),
      onEscape: () => undefined,
      recordAfter: (element) => {
        const entry = this.selected();
        if (!entry) return;
        recordTextAfter(entry.change, element);
        this.changed(entry);
      },
      t: options.t,
      toast: options.onToast
    });
  }

  select(element: InspectableElement): ElementSnapshot {
    this.editor.stop();
    for (const [id, entry] of this.entries) if (!hasRecordedChange(entry.change)) { this.entries.delete(id); forgetDomSnapshot(id); }
    const change = createStyleChange(element, EDITABLE_PROPS);
    change.context = this.options.context();
    const entry = { change, element, identity: fingerprint(element) };
    this.entries.set(change.id, entry);
    this.selectedId = change.id;
    this.options.roots.register(rootOf(element));
    this.options.onHighlight(element);
    const result = this.snapshot(entry);
    this.options.onSelected(result);
    return result;
  }

  execute(change: StyleChange, command: ElementCommand): Record<string, unknown> {
    let entry = this.entries.get(change.id);
    if (!entry) {
      const resolved = resolveChangeElement(change);
      entry = { change, element: resolved.element, identity: change.address?.fingerprint ?? (resolved.element ? fingerprint(resolved.element) : { tag: "", namespace: "", attributes: {}, text: "" }) };
      this.entries.set(change.id, entry);
    }
    if (command.action === "forget") {
      forgetDomSnapshot(change.id);
      this.entries.delete(change.id);
      if (this.selectedId === change.id) this.clearSelection();
      return { ok: true };
    }
    if (command.action === "text-stop") {
      if (this.selectedId === change.id) this.editor.stop();
      return { ok: true };
    }
    if (command.action === "verify") {
      const resolved = resolveChangeElement(change);
      const result = this.options.roots.mutate(resolved.element ?? document, () => verifyStyleChange(change, resolved.element, {
        pageLoadId: this.options.context().documentId,
        mutationVersion: resolved.root ? this.options.roots.version(resolved.root) : 0,
        exportedElement: entry!.exportedElement ?? null,
        normalizationRoot: resolved.element?.parentNode ?? resolved.root ?? null,
        resolution: resolved.status,
        t: this.options.t
      }));
      return { ok: true, verification: result };
    }
    if (command.action === "mark") {
      const resolved = resolveChangeElement(entry.change);
      entry.exportedElement = resolved.element;
      Object.assign(entry.change, {
        exportedAt: Date.now(), exportedPageLoadId: this.options.context().documentId,
        exportedMutationVersion: resolved.root ? this.options.roots.version(resolved.root) : 0, verificationStatus: "waiting"
      });
      return { ok: true, snapshot: this.snapshot(entry) };
    }
    const element = entry.element;
    if (element && element.isConnected && !matchesFingerprint(element, entry.identity, entry.change.textAfter)) {
      return { ok: false, status: "stale-handle", error: this.options.t("elementContextUnavailable") };
    }
    if (command.action === "undo" && !element?.isConnected) {
      const restored = restoreDeletedChange(entry.change);
      if (!restored) return { ok: false, status: "stale-handle", error: this.options.t("elementRestoreFailed") };
      this.entries.delete(change.id);
      this.clearSelection();
      return { ok: true, removed: change.id };
    }
    if (!element?.isConnected) {
      const resolved = resolveChangeElement(entry.change);
      if (!resolved.element) return { ok: false, status: resolved.status, error: this.options.t(resolved.status === "ambiguous" ? "elementAddressAmbiguous" : "elementContextUnavailable") };
      entry.element = resolved.element;
      entry.identity = fingerprint(resolved.element);
    }
    const target = entry.element!;
    if (command.action === "parent") {
      const parent = composedParent(target);
      if (!isInspectableElement(parent) || isDevLiteNode(parent)) return { ok: false, status: "unsupported" };
      return { ok: true, snapshot: this.select(parent) };
    }
    if (command.action === "text-start") {
      if (!canEditTextContent(target)) return { ok: false, status: "unsupported", error: this.options.t("noEditableText") };
      this.selectedId = change.id;
      this.editor.start(target);
      return { ok: true };
    }
    if (command.action === "text" && !canEditTextContent(target, entry.change.textAfter !== undefined)) {
      return { ok: false, status: "unsupported", error: this.options.t("noEditableText") };
    }
    if ((command.action === "image" && !canReplaceImage(target)) || (command.action === "icon" && !canReplaceIcon(target))) return { ok: false, status: "unsupported" };
    let undone = false;
    this.options.roots.mutate(command.action === "delete" ? target.parentNode ?? target : command.action === "image" ? target.closest("picture") ?? target : target, () => {
      switch (command.action) {
        case "style":
          if (!(EDITABLE_PROPS as readonly string[]).includes(command.property)) throw new Error("Unsupported CSS property");
          applyStyleChange(entry!.change, target, command.property, command.value);
          break;
        case "requirement":
          entry!.change.requirement = command.text.trim() ? { text: command.text.trim() } : undefined;
          break;
        case "image":
          applyImageReplacement(entry!.change, target, command.src, command.label, command.metadata);
          break;
        case "icon":
          applyIconReplacement(entry!.change, target, command.value, command.label);
          break;
        case "text":
          ensureTextChangeBaseline(entry!.change, target);
          target.textContent = command.value;
          recordTextAfter(entry!.change, target);
          break;
        case "delete":
          ensureDomChangeBaseline(entry!.change, target, this.options.t("deleteElement"));
          if (isInspectableElement(target.parentNode)) entry!.change.parentAddress = buildElementAddress(target.parentNode);
          entry!.change.domAfter = "";
          target.remove();
          this.editor.stop();
          break;
        case "undo":
          undone = !!undoStyleChange(entry!.change, target);
          break;
      }
    });
    if (command.action === "undo") {
      if (!undone) return { ok: false, error: this.options.t("elementRestoreFailed") };
      this.entries.delete(change.id);
      this.clearSelection();
      return { ok: true, removed: change.id };
    }
    this.changed(entry);
    return { ok: true, snapshot: this.snapshot(entry), deleted: command.action === "delete" };
  }

  clearSelection(): void {
    this.editor.stop();
    const entry = this.selected();
    if (entry && !hasRecordedChange(entry.change)) { forgetDomSnapshot(entry.change.id); this.entries.delete(entry.change.id); }
    this.selectedId = null;
    this.options.onHighlight(null);
  }

  hasChanges(): boolean { return [...this.entries.values()].some((entry) => hasRecordedChange(entry.change)); }

  isSelectedTarget(element: InspectableElement | null): boolean { return !!element && !!this.selected()?.element?.contains(element); }

  editSelectedText(): void {
    const entry = this.selected();
    if (entry?.element && canEditTextContent(entry.element)) this.editor.start(entry.element);
  }

  refreshHighlight(): void {
    const entry = this.selected();
    if (!entry) return;
    if (!entry.element?.isConnected || !matchesFingerprint(entry.element, entry.identity, entry.change.textAfter)) {
      this.clearSelection();
      return;
    }
    this.options.onHighlight(entry.element);
  }

  private selected(): Entry | undefined { return this.selectedId ? this.entries.get(this.selectedId) : undefined; }

  private changed(entry: Entry): void {
    entry.change.updatedAt = Date.now();
    entry.change.context = this.options.context();
    delete entry.change.exportedAt;
    delete entry.change.exportedPageLoadId;
    delete entry.change.exportedMutationVersion;
    delete entry.change.verificationStatus;
    if (entry.element) entry.identity = fingerprint(entry.element);
    this.options.onChanged(this.snapshot(entry));
    this.options.onHighlight(entry.element?.isConnected ? entry.element : null);
  }

  private snapshot(entry: Entry): ElementSnapshot {
    const element = entry.element;
    const computed: Record<string, string> = {};
    if (element?.isConnected) {
      const style = computedStyle(element);
      for (const prop of EDITABLE_PROPS) computed[prop] = style.getPropertyValue(prop);
    }
    const rect = element?.getBoundingClientRect();
    return { change: entry.change, computed, canEditText: !!element && canEditTextContent(element, entry.change.textAfter !== undefined), canReplaceImage: !!element && canReplaceImage(element), canReplaceIcon: !!element && canReplaceIcon(element), width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }
}
