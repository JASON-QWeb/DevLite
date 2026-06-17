import type { ContentTextKey } from "./i18n";
import { LOGO_URL } from "./panelConfig";
import { escapeHtml } from "./utils";
import { launcherIcon } from "./views/icons";

type LauncherText = (key: ContentTextKey) => string;

type LauncherDockOptions = {
  t: LauncherText;
  onOpenPanel: () => void;
  onStartInspector: () => void;
  onToast: (message: string) => void;
  initialTop?: number;
};

export class LauncherDockController {
  readonly element: HTMLDivElement;

  private collapseTimer: number | null = null;
  private suppressClick = false;
  private top: number;
  private t: LauncherText;

  constructor(private readonly options: LauncherDockOptions) {
    this.t = options.t;
    this.top = options.initialTop ?? Math.round(window.innerHeight / 2);
    this.element = document.createElement("div");
    this.element.className = "devlite-dock";
    this.element.innerHTML = launcherMarkup(this.t);
    this.bindEvents();
  }

  syncLabels(t: LauncherText): void {
    this.t = t;
    const actions = this.element.querySelector<HTMLElement>(".launcher-actions");
    const select = this.element.querySelector<HTMLButtonElement>('[data-launcher-action="select"]');
    const panelButton = this.element.querySelector<HTMLButtonElement>('[data-launcher-action="panel"]');
    const launcher = this.element.querySelector<HTMLButtonElement>(".devlite-launcher");
    actions?.setAttribute("aria-label", t("launcherActions"));
    setButtonLabel(select, t("quickSelect"));
    setButtonLabel(panelButton, t("openPanel"));
    setButtonLabel(launcher, t("launcherTitle"));
  }

  applyPosition(): void {
    const minTop = Math.min(74, Math.max(36, window.innerHeight / 2));
    const maxTop = Math.max(minTop, window.innerHeight - minTop);
    this.top = Math.min(Math.max(minTop, this.top), maxTop);
    this.element.style.top = `${this.top}px`;
  }

  private bindEvents(): void {
    const launcher = this.element.querySelector<HTMLButtonElement>(".devlite-launcher");
    const hitArea = this.element.querySelector<HTMLDivElement>(".launcher-hit-area");
    const actionButtons = Array.from(this.element.querySelectorAll<HTMLButtonElement>("[data-launcher-action]"));
    this.element.addEventListener("pointerenter", () => this.setExpanded(true));
    this.element.addEventListener("pointerleave", () => this.scheduleCollapse());
    this.element.addEventListener("focusin", () => this.setExpanded(true));
    this.element.addEventListener("focusout", () => this.scheduleCollapse());
    [launcher, hitArea, ...actionButtons].forEach((node) => {
      node?.addEventListener("pointerenter", () => this.setExpanded(true));
      node?.addEventListener("pointerleave", () => this.scheduleCollapse());
    });
    launcher?.addEventListener("pointerdown", (event) => this.startDrag(event));
    launcher?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.options.onOpenPanel();
    });

    actionButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.launcherAction;
        this.setExpanded(false);
        if (action === "select") {
          this.options.onStartInspector();
          this.options.onToast(this.t("clickToSelect"));
          return;
        }
        this.options.onOpenPanel();
      });
    });
  }

  private setExpanded(expanded: boolean): void {
    if (this.collapseTimer !== null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    this.element.classList.toggle("expanded", expanded);
  }

  private scheduleCollapse(): void {
    if (this.element.matches(":focus-within")) return;
    if (this.collapseTimer !== null) {
      window.clearTimeout(this.collapseTimer);
    }
    this.collapseTimer = window.setTimeout(() => {
      this.element.classList.remove("expanded");
      this.collapseTimer = null;
    }, 220);
  }

  private startDrag(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const launcher = event.currentTarget as HTMLButtonElement;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startTop = this.top;
    let moved = false;

    launcher.setPointerCapture(pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      if (Math.abs(delta) > 3) moved = true;
      this.top = startTop + delta;
      this.applyPosition();
    };

    const onUp = () => {
      this.suppressClick = moved;
      if (launcher.hasPointerCapture(pointerId)) {
        launcher.releasePointerCapture(pointerId);
      }
      launcher.removeEventListener("pointermove", onMove);
      launcher.removeEventListener("pointerup", onUp);
      launcher.removeEventListener("pointercancel", onUp);
    };

    launcher.addEventListener("pointermove", onMove);
    launcher.addEventListener("pointerup", onUp);
    launcher.addEventListener("pointercancel", onUp);
  }
}

function launcherMarkup(t: LauncherText): string {
  const launcherActions = escapeHtml(t("launcherActions"));
  const quickSelect = escapeHtml(t("quickSelect"));
  const openPanel = escapeHtml(t("openPanel"));
  const launcherTitle = escapeHtml(t("launcherTitle"));
  return `
      <div class="launcher-hit-area" aria-hidden="true"></div>
      <div class="launcher-actions" aria-label="${launcherActions}">
        <button class="launcher-action" type="button" data-launcher-action="select" title="${quickSelect}" aria-label="${quickSelect}">${launcherIcon("select")}</button>
        <button class="launcher-action" type="button" data-launcher-action="panel" title="${openPanel}" aria-label="${openPanel}">${launcherIcon("panel")}</button>
      </div>
      <button class="devlite-launcher" type="button" title="${launcherTitle}" aria-label="${launcherTitle}">
        <img src="${LOGO_URL}" alt="" />
      </button>
    `;
}

function setButtonLabel(button: HTMLButtonElement | null | undefined, label: string): void {
  if (!button) return;
  button.title = label;
  button.setAttribute("aria-label", label);
}
