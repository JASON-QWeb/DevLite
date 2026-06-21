export type MemoryInfo = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

export function getMemoryInfo(): MemoryInfo | null {
  const memory = (performance as Performance & { memory?: MemoryInfo }).memory;
  if (
    !memory ||
    !Number.isFinite(memory.usedJSHeapSize) ||
    !Number.isFinite(memory.totalJSHeapSize) ||
    !Number.isFinite(memory.jsHeapSizeLimit)
  ) {
    return null;
  }
  return memory;
}
