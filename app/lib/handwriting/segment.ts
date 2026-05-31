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

// A real character break is never crossed by a stroke — the pen lifts between
// characters. So a predicted boundary that a stroke *straddles* (extends well
// past on BOTH sides) is splitting one wide character at an internal gap, not
// separating two characters. This is the dominant Draw-mode over-segmentation
// cause: the segmenter strip is height-normalized, so a wide-short single char
// (一 二 三 王 工 五 皿 四 …) is stretched to several character-widths and the
// model fires phantom internal boundaries. Vetoing stroke-crossed boundaries
// only ever *merges*, so it can never under-segment genuine multi-character
// input — there, each character's strokes stay on their own side of the break.
//
// The signal also resolves the case the segmenter alone can't: 二 (one wide
// char, both horizontal strokes span the full width → every internal cut is
// crossed → merged) vs 一一 (two chars, each stroke confined to its own half →
// the cut between them is crossed by neither → kept).

/** Straddle tolerance as a fraction of the drawing's height (≈ the em / line
 *  height). A stroke must reach more than this past the cut on each side to
 *  count as crossing it, so minor freehand overshoot into the gap is ignored. */
const CROSS_TOL_FRAC = 0.15;

/** Vertical extent of all ink (a character-size proxy). 0 when degenerate. */
function drawingHeight(strokes: Stroke[]): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return maxY > minY ? maxY - minY : 0;
}

/** True if any stroke reaches more than `tol` past `x` on both sides — i.e. it
 *  crosses the boundary rather than merely ending near it. */
function boundaryCrossedByStroke(strokes: Stroke[], x: number, tol: number): boolean {
  for (const s of strokes) {
    let left = false;
    let right = false;
    for (const p of s) {
      if (p.x < x - tol) left = true;
      else if (p.x > x + tol) right = true;
      if (left && right) return true;
    }
  }
  return false;
}

/**
 * Drop predicted boundaries that a stroke crosses (see the note above). Pure;
 * `boundaries` and stroke coordinates share the drawing-pixel space.
 */
export function filterBoundariesByStrokes(
  strokes: Stroke[],
  boundaries: number[],
): number[] {
  if (boundaries.length === 0) return boundaries;
  const tol = Math.max(1, CROSS_TOL_FRAC * drawingHeight(strokes));
  return boundaries.filter((x) => !boundaryCrossedByStroke(strokes, x, tol));
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
  // Discard boundaries that cut through a stroke before splitting — those are
  // internal gaps of one wide character, not breaks between characters.
  const cuts = filterBoundariesByStrokes(live, boundaries).sort((a, b) => a - b);
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
