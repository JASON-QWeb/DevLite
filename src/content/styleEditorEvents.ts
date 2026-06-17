type StyleEditorEventsOptions = {
  editor: HTMLElement | null;
  onAction: (action: string) => Promise<void> | void;
  onError: (error: unknown) => void;
  onStartDrag: (event: PointerEvent) => void;
  onStyleInput: (prop: string, value: string) => void;
};

export function bindStyleEditorEvents(options: StyleEditorEventsOptions): void {
  const { editor } = options;
  if (!editor) return;
  editor.querySelector<HTMLElement>(".style-editor-head")?.addEventListener("pointerdown", options.onStartDrag);
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

  editor.querySelectorAll<HTMLButtonElement>("[data-style-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await options.onAction(button.dataset.styleAction ?? "");
      } catch (error) {
        options.onError(error);
      }
    });
  });
}
