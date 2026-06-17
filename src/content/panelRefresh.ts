type PanelRefreshOptions = {
  isEditingField: () => boolean;
  isPanelOpen: () => boolean;
  refresh: () => Promise<void>;
  render: () => void;
  shouldSkipIntervalRender: () => boolean;
};

export class PanelRefreshController {
  private refreshTimer: number | null = null;
  private renderQueued = false;

  constructor(private readonly options: PanelRefreshOptions) {}

  start(): void {
    if (this.refreshTimer !== null) return;
    void this.options.refresh().then(() => {
      if (this.options.isPanelOpen()) this.options.render();
    });
    this.refreshTimer = window.setInterval(() => {
      void this.options.refresh().then(() => {
        if (!this.options.isPanelOpen() || this.options.shouldSkipIntervalRender()) return;
        this.options.render();
      });
    }, 1400);
  }

  stop(): void {
    if (this.refreshTimer === null) return;
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  scheduleRender(): void {
    if (!this.options.isPanelOpen() || this.renderQueued || this.options.isEditingField()) return;
    this.renderQueued = true;
    window.setTimeout(() => {
      this.renderQueued = false;
      if (this.options.isPanelOpen()) this.options.render();
    }, 120);
  }
}
