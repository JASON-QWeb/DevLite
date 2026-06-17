import type { FloatingPosition } from "./types";

export function pickStyleEditorPosition(target: DOMRect, width: number, height: number): FloatingPosition {
  const gap = 10;
  const topAligned = clampValue(target.top, 8, maxFloatingTop(height));
  const leftAligned = clampValue(target.left, 8, maxFloatingLeft(width));
  const candidates = [
    { left: target.right + gap, top: topAligned, priority: 0 },
    { left: target.left - width - gap, top: topAligned, priority: 1 },
    { left: leftAligned, top: target.bottom + gap, priority: 2 },
    { left: leftAligned, top: target.top - height - gap, priority: 3 },
    { left: window.innerWidth - width - 8, top: 8, priority: 4 },
    { left: 8, top: 8, priority: 5 }
  ].map((candidate) => {
    const clamped = clampFloatingPosition(candidate.left, candidate.top, width, height);
    return {
      ...clamped,
      priority: candidate.priority,
      overlap: overlapArea(target, { left: clamped.left, top: clamped.top, right: clamped.left + width, bottom: clamped.top + height })
    };
  });

  candidates.sort((a, b) => a.overlap - b.overlap || a.priority - b.priority);
  return { left: candidates[0].left, top: candidates[0].top, manual: false };
}

export function clampFloatingPosition(left: number, top: number, width: number, height: number): Pick<FloatingPosition, "left" | "top"> {
  return {
    left: clampValue(left, 8, maxFloatingLeft(width)),
    top: clampValue(top, 8, maxFloatingTop(height))
  };
}

function maxFloatingLeft(width: number): number {
  return Math.max(8, window.innerWidth - Math.min(width, window.innerWidth - 16) - 8);
}

function maxFloatingTop(height: number): number {
  return Math.max(8, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8);
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function overlapArea(a: DOMRect, b: { left: number; top: number; right: number; bottom: number }): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}
