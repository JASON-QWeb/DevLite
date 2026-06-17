import type { DiagnosticFilter, NetworkDetailTab, OverlayTab } from "./types";

type PanelEventsOptions = {
  panel: HTMLElement | null;
  onAction: (action: string, source?: HTMLElement) => Promise<void> | void;
  onError: (error: unknown) => void;
  onDiagnosticFilter: (filter: DiagnosticFilter) => void;
  onNetworkDetail: (tab: NetworkDetailTab) => void;
  onNetworkEvent: (id: string | null) => void;
  onNetworkListResize: (event: PointerEvent) => void;
  onStartDrag: (event: PointerEvent) => void;
  onStartResize: (event: PointerEvent) => void;
  onStyleInput: (prop: string, value: string) => void;
  onTab: (tab: OverlayTab) => void;
  onTextInput: (value: string) => void;
  onThemeChange: (theme: string) => void;
};

export function bindPanelEvents(options: PanelEventsOptions): void {
  const { panel } = options;
  if (!panel) return;
  panel.querySelectorAll<HTMLElement>(".panel-header, .panel-sidebar").forEach((dragArea) => {
    dragArea.addEventListener("pointerdown", options.onStartDrag);
  });

  panel.querySelector<HTMLElement>("[data-panel-resize]")?.addEventListener("pointerdown", options.onStartResize);
  panel.querySelector<HTMLElement>("[data-network-splitter]")?.addEventListener("pointerdown", options.onNetworkListResize);

  panel.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tab = button.dataset.tab as OverlayTab | undefined;
      if (tab) options.onTab(tab);
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("button[data-network-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onNetworkEvent(button.dataset.networkId ?? null);
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("button[data-network-detail]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tab = button.dataset.networkDetail as NetworkDetailTab | undefined;
      if (tab) options.onNetworkDetail(tab);
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("button[data-diagnostic-filter]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const filter = button.dataset.diagnosticFilter as DiagnosticFilter | undefined;
      if (filter) options.onDiagnosticFilter(filter);
    });
  });

  panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-prop]").forEach((input) => {
    input.addEventListener("input", () => {
      const prop = input.dataset.prop;
      if (prop) options.onStyleInput(prop, input.value);
    });
    input.addEventListener("change", () => {
      const prop = input.dataset.prop;
      if (prop) options.onStyleInput(prop, input.value);
    });
  });

  panel.querySelectorAll<HTMLTextAreaElement>("textarea[data-text-content]").forEach((textarea) => {
    textarea.addEventListener("input", () => options.onTextInput(textarea.value));
    textarea.addEventListener("change", () => options.onTextInput(textarea.value));
  });

  panel.querySelectorAll<HTMLInputElement>('input[name="uiTheme"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) options.onThemeChange(input.value);
    });
  });

  panel.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await options.onAction(button.dataset.action ?? "", button);
      } catch (error) {
        options.onError(error);
      }
    });
  });
}
