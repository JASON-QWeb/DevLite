type PanelRefreshOptions = {
  isEditingField: () => boolean;
  isPanelOpen: () => boolean;
  refresh: () => Promise<void>;
  render: () => void;
  shouldSkipIntervalRender: () => boolean;
};

export class PanelRefreshController {
  private refreshTimer: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  private renderQueued = false;
  private generation = 0;

  constructor(private readonly options: PanelRefreshOptions) {}

  start(): void {
    if (this.refreshTimer !== null) return;
    const generation = ++this.generation;
    void this.runRefresh(generation, true);
    this.refreshTimer = window.setInterval(() => {
      void this.runRefresh(generation, false);
    }, 1400);
  }

  stop(): void {
    if (this.refreshTimer === null) return;
    this.generation += 1;
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

  private async runRefresh(generation: number, forceRender: boolean): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
    } else {
      this.refreshPromise = this.options.refresh().catch(() => undefined);
      await this.refreshPromise;
      this.refreshPromise = null;
    }
    if (generation !== this.generation || !this.options.isPanelOpen()) return;
    if (!forceRender && this.options.shouldSkipIntervalRender()) return;
    this.options.render();
  }
}
