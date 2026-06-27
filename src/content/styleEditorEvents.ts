type StyleEditorEventsOptions = {
  editor: HTMLElement | null;
  onAction: (action: string, source?: HTMLElement) => Promise<void> | void;
  onError: (error: unknown) => void;
  onStartDrag: (event: PointerEvent) => void;
  onStartResize: (event: PointerEvent) => void;
  onStyleInput: (prop: string, value: string) => void;
};

export function bindStyleEditorEvents(options: StyleEditorEventsOptions): void {
  const { editor } = options;
  if (!editor) return;
  editor.querySelector<HTMLElement>(".style-editor-head")?.addEventListener("pointerdown", options.onStartDrag);
  editor.querySelector<HTMLElement>("[data-style-editor-resize]")?.addEventListener("pointerdown", options.onStartResize);
  editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-prop]").forEach((input) => {
    input.addEventListener("input", () => {
      const prop = input.dataset.prop;
      if (prop) options.onStyleInput(prop, input.value);
    });
    input.addEventListener("change", () => {
      const prop = input.dataset.prop;
      if (prop) options.onStyleInput(prop, input.value);
    });
  });
  editor.querySelector<HTMLInputElement>("[data-icon-asset-search]")?.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await options.onAction("icon-asset-search", event.currentTarget as HTMLElement);
    } catch (error) {
      options.onError(error);
    }
  });

  editor.querySelectorAll<HTMLButtonElement>("[data-style-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await options.onAction(button.dataset.styleAction ?? "", button);
      } catch (error) {
        options.onError(error);
      }
    });
  });
}
