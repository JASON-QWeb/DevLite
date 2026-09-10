import { isDevLiteNode, isElement, isShadowRoot, shadowRootOf, type DomRoot } from "./domContext";

type RootEntry = { observer: MutationObserver; version: number };

/** A document's roots share discovery, mutation filtering and scroll listeners. */
export class RootRegistry {
  readonly roots = new Map<DomRoot, RootEntry>();
  private queue: Element[] = [];
  private queued = new WeakSet<Element>();
  private scanTimer: number | null = null;
  private discoveryTimer: number | null = null;
  private running = false;
  private versions = new WeakMap<DomRoot, number>();

  constructor(
    private readonly doc: Document,
    private readonly onMutations: (mutations: MutationRecord[], root: DomRoot) => void,
    private readonly onScroll: () => void
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.register(this.doc);
    this.discover(this.doc);
  }

  setActive(active: boolean): void {
    if (active && this.discoveryTimer === null) {
      this.discover(this.doc);
      this.discoveryTimer = window.setInterval(() => this.discover(this.doc), 2000);
    } else if (!active && this.discoveryTimer !== null) {
      window.clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
  }

  register(root: DomRoot): void {
    if (this.roots.has(root) || isDevLiteNode(root)) return;
    const observer = new MutationObserver((records) => this.process(root, records));
    this.roots.set(root, { observer, version: this.versions.get(root) ?? 0 });
    observer.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
    root.addEventListener("scroll", this.onScroll, true);
    root.addEventListener("slotchange", this.onScroll, true);
  }

  version(root: DomRoot): number {
    this.register(root);
    return this.roots.get(root)?.version ?? 0;
  }

  mutate<T>(element: Node, operation: () => T): T {
    for (const [root, entry] of this.roots) this.process(root, entry.observer.takeRecords());
    try { return operation(); }
    finally {
      for (const [root, entry] of this.roots) {
        this.process(root, entry.observer.takeRecords().filter((record) => record.target !== element && !element.contains(record.target)));
      }
    }
  }

  discover(node: Node): void {
    if (!this.running || isDevLiteNode(node)) return;
    const elements = isElement(node) ? [node] : Array.from((node as ParentNode).children ?? []);
    for (const element of elements) {
      if (this.queued.has(element)) continue;
      this.queued.add(element);
      this.queue.push(element);
    }
    if (this.scanTimer === null && this.queue.length) this.scanTimer = window.setTimeout(() => this.scan(), 0);
  }

  stop(): void {
    this.running = false;
    this.setActive(false);
    if (this.scanTimer !== null) window.clearTimeout(this.scanTimer);
    this.scanTimer = null;
    for (const [root, entry] of this.roots) this.remove(root, entry);
    this.queue = [];
    this.queued = new WeakSet();
  }

  private scan(): void {
    this.scanTimer = null;
    const batch = this.queue.splice(0, 300);
    for (const element of batch) {
      this.queued.delete(element);
      if (!element.isConnected || isDevLiteNode(element)) continue;
      const root = shadowRootOf(element);
      if (root) {
        this.register(root);
        for (const child of Array.from(root.children)) this.discover(child);
      }
      for (const child of Array.from(element.children)) this.discover(child);
    }
    for (const [root, entry] of this.roots) {
      if (isShadowRoot(root) && !root.host.isConnected) this.remove(root, entry);
    }
    if (this.queue.length && this.scanTimer === null) this.scanTimer = window.setTimeout(() => this.scan(), 0);
  }

  private process(root: DomRoot, records: MutationRecord[]): void {
    const relevant = records.filter((record) => !isDevLiteNode(record.target) &&
      !(record.type === "childList" && [...record.addedNodes, ...record.removedNodes].every(isDevLiteNode)));
    if (!relevant.length) return;
    const entry = this.roots.get(root);
    if (entry) { entry.version += 1; this.versions.set(root, entry.version); }
    for (const record of relevant) for (const node of record.addedNodes) if (isElement(node)) this.discover(node);
    if (relevant.some((record) => record.removedNodes.length)) {
      for (const [candidate, candidateEntry] of this.roots) if (isShadowRoot(candidate) && !candidate.host.isConnected) this.remove(candidate, candidateEntry);
      this.queue = this.queue.filter((element) => {
        if (element.isConnected) return true;
        this.queued.delete(element);
        return false;
      });
    }
    this.onMutations(relevant, root);
  }

  private remove(root: DomRoot, entry: RootEntry): void {
    entry.observer.disconnect();
    root.removeEventListener("scroll", this.onScroll, true);
    root.removeEventListener("slotchange", this.onScroll, true);
    this.roots.delete(root);
  }
}
