// Splits a free-form drawing into one cluster per detected character so the
// single-character recognizer can be run per cluster. Two entry points:
//
//   • `segmentStrokes` — heuristic left-to-right pass used to seed the
//     recognizer. Conservative: only splits when a clear horizontal gap
//     coincides with an aspect ratio that already looks "wider than a kanji."
//
//   • `splitGroupAtLargestGap` — fallback used by the confidence-driven
//     re-split path (`recognizeMulti`). When the recognizer is unsure about
//     a cluster, the caller asks for the largest internal x-gap so it can
//     try recognizing each half separately.
//
// Both work purely on the per-stroke bbox geometry — no rasterization, no
// model — and only know about left-to-right reading order. Vertical writing
// would need a parallel y-axis pass; not implemented since the canvas UI is
// horizontal.

import type { Stroke } from "./types";

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// Conservative left-to-right segmentation tuning. All thresholds are
// expressed as fractions of the overall drawing height so the values are
// independent of canvas size.
const SEGMENT_TUNING = {
  /** Min x-gap (as a fraction of overall height) before a split is *considered*. */
  minGapFrac: 0.15,
  /** Above this gap fraction we split regardless of aspect ratio. */
  largeGapFrac: 0.4,
  /** Cluster width/height beyond which we treat it as "already wider than a kanji" and split on any qualifying gap. */
  aspectThreshold: 1.3,
  /** Don't apply the aspect-based split when the running cluster is still short — protects 一 / 三 / 二 from spurious splits. */
  minClusterHeightFrac: 0.4,
} as const;

function strokeBounds(stroke: Stroke): Bounds | null {
  if (stroke.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of stroke) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

type Item = { stroke: Stroke; bounds: Bounds; index: number };

function indexStrokes(strokes: Stroke[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < strokes.length; i++) {
    const b = strokeBounds(strokes[i]);
    if (b) items.push({ stroke: strokes[i], bounds: b, index: i });
  }
  return items;
}

/** Sort cluster strokes back into the original drawing order so the
 *  recognizer sees them as the user drew them. */
function restoreOrder(items: Item[]): Stroke[] {
  return items.slice().sort((a, b) => a.index - b.index).map((i) => i.stroke);
}

/**
 * Heuristic left-to-right segmentation. Returns one stroke group per detected
 * character, ordered left-to-right. An empty input returns an empty array.
 * Single-stroke input always returns one group.
 */
export function segmentStrokes(strokes: Stroke[]): Stroke[][] {
  const items = indexStrokes(strokes);
  if (items.length === 0) return [];
  if (items.length === 1) return [[items[0].stroke]];

  // Overall y-span gives us a stable size estimate. Using max(stroke height)
  // works too but breaks on inputs like 三 where every individual stroke is
  // short — the union span is closer to the user's "character height."
  let overallMinY = Infinity, overallMaxY = -Infinity;
  for (const it of items) {
    if (it.bounds.minY < overallMinY) overallMinY = it.bounds.minY;
    if (it.bounds.maxY > overallMaxY) overallMaxY = it.bounds.maxY;
  }
  const H = Math.max(1, overallMaxY - overallMinY);

  // Sort by left edge for the sweep.
  const sorted = items.slice().sort((a, b) => a.bounds.minX - b.bounds.minX);

  const clusters: Item[][] = [];
  let current: Item[] = [sorted[0]];
  let currentBounds = sorted[0].bounds;

  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const gap = it.bounds.minX - currentBounds.maxX;
    const merged = mergeBounds(currentBounds, it.bounds);
    const mergedW = merged.maxX - merged.minX;
    const mergedH = Math.max(1, merged.maxY - merged.minY);
    const aspect = mergedW / mergedH;

    let split = false;
    if (gap > SEGMENT_TUNING.largeGapFrac * H) {
      split = true;
    } else if (
      gap > SEGMENT_TUNING.minGapFrac * H &&
      aspect > SEGMENT_TUNING.aspectThreshold &&
      mergedH > SEGMENT_TUNING.minClusterHeightFrac * H
    ) {
      split = true;
    }

    if (split) {
      clusters.push(current);
      current = [it];
      currentBounds = it.bounds;
    } else {
      current.push(it);
      currentBounds = merged;
    }
  }
  clusters.push(current);

  return clusters.map(restoreOrder);
}

/**
 * Fallback split used by the confidence-driven re-recognition path. Finds the
 * widest non-overlapping x-gap between strokes and splits there. Returns null
 * when the group has fewer than two strokes, or when no horizontal gap exists
 * (i.e. every stroke overlaps its neighbours along x).
 */
export function splitGroupAtLargestGap(strokes: Stroke[]): Stroke[][] | null {
  const items = indexStrokes(strokes);
  if (items.length < 2) return null;

  const sorted = items.slice().sort((a, b) => a.bounds.minX - b.bounds.minX);

  // Track the widest gap between the running cluster's right edge and the
  // next stroke's left edge. Splitting at the running edge (rather than
  // adjacent pairs) keeps the split honest when a tall stroke spans far
  // past the start of the next one.
  let bestGap = -Infinity;
  let bestSplitIndex = -1;
  let runningMaxX = sorted[0].bounds.maxX;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].bounds.minX - runningMaxX;
    if (gap > bestGap) {
      bestGap = gap;
      bestSplitIndex = i;
    }
    if (sorted[i].bounds.maxX > runningMaxX) runningMaxX = sorted[i].bounds.maxX;
  }

  if (bestSplitIndex < 0 || bestGap <= 0) return null;

  const left = sorted.slice(0, bestSplitIndex);
  const right = sorted.slice(bestSplitIndex);
  return [restoreOrder(left), restoreOrder(right)];
}
