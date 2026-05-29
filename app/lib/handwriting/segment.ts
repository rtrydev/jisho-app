// Splits a multi-character drawing into one stroke group per character.
//
// Segmentation is decided by a dedicated boundary model (see segmentStrip.ts +
// the segmenter ONNX): it predicts the x-positions, in drawing coordinates,
// where one character ends and the next begins. This module is the pure,
// model-free half — given those boundaries, it assigns each stroke to a
// character by its horizontal centre and returns the groups left-to-right.
//
// Keeping this a pure function (no canvas, no ORT) makes it unit-testable and
// keeps the model boundary in one place (segmentStrip.ts).

import type { Stroke } from "./types";

function strokeCentroidX(stroke: Stroke): number {
  let sum = 0;
  for (const p of stroke) sum += p.x;
  return stroke.length ? sum / stroke.length : 0;
}

/**
 * Group strokes into characters using boundary x-positions (drawing coords).
 *
 * A stroke joins the character whose x-interval contains its centroid: the
 * count of boundaries to the left of the centroid is its character index.
 * Returns groups left-to-right, skipping any character interval that caught no
 * strokes. With no boundaries, all strokes form a single group.
 */
export function splitStrokesByBoundaries(
  strokes: Stroke[],
  boundaries: number[],
): Stroke[][] {
  const live = strokes.filter((s) => s.length > 0);
  if (live.length === 0) return [];
  const cuts = boundaries.slice().sort((a, b) => a - b);
  if (cuts.length === 0) return [live];

  const groups: Stroke[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (const stroke of live) {
    const cx = strokeCentroidX(stroke);
    let idx = 0;
    while (idx < cuts.length && cx >= cuts[idx]) idx++;
    groups[idx].push(stroke);
  }
  return groups.filter((g) => g.length > 0);
}
