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

// Dakuten/handakuten merge veto (kana). A voiced kana (が ざ ぱ …) is its base
// kana plus 2–3 *tiny* marks drawn at the upper-right. Those marks don't overlap
// the base horizontally, so the stroke-crossing veto above can't merge them — the
// segmenter can split them off as a phantom extra character. A real character is
// never a tiny mark sitting high above the baseline, so a group that is *only*
// small, high-positioned strokes is a dakuten and is merged into the character to
// its left. Like the stroke-crossing veto this can ONLY merge, so it can't
// under-segment genuine multi-character input. (Small kana っゃ are folded onto
// their full forms and never reach here; bottom-sitting punctuation fails the
// "high" test and is left alone.)
/** A mark's bbox spans less than this fraction of the em on BOTH axes. */
const MARK_MAX_DIM_FRAC = 0.34;
/** ...and its lowest point stays within this fraction of the em from the top. */
const MARK_TOP_FRAC = 0.55;
/** Below this em (drawing-pixel) the line is too small for "mark vs character"
 *  to mean anything — a stroke and a glyph are the same size — so the merge is
 *  skipped. Real Draw input puts the em in the hundreds of px; this only fences
 *  off degenerate/zero-extent geometry. */
const MARK_MIN_EM = 24;

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

// Stray-ink veto. An accidental touch (palm graze, a tap while repositioning)
// leaves a tiny stroke far from the writing; it then either becomes a phantom
// "character" group of its own or, worse, lands in a real character's group
// and inflates its bbox so the glyph shrinks/offsets inside the 96² model
// input. A stray is recognized by being BOTH tiny relative to the em AND far
// from the union of the real (non-tiny) strokes — a dakuten or the dot of 犬
// is tiny but always hugs its base, so distance is what separates "mark" from
// "junk". Tiny strokes near the core, and all non-tiny strokes, are untouched.
/** A stroke is "tiny" when its bbox is below this fraction of the em on BOTH
 *  axes. Comfortably above a dakuten mark is NOT needed here — tiny strokes
 *  are only dropped when they are also far away (see STRAY_GAP_FRAC). */
const STRAY_MAX_DIM_FRAC = 0.1;
/** ...and "far" when its bbox sits more than this fraction of the em from the
 *  union bbox of the non-tiny strokes (max axis gap). */
const STRAY_GAP_FRAC = 0.3;

type GroupBounds = { minX: number; maxX: number; minY: number; maxY: number };

function groupBounds(group: Stroke[]): GroupBounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of group) {
    for (const p of s) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/** True if `group` is a dakuten/handakuten-style mark cluster: small on both
 *  axes relative to the em and sitting high (its lowest point is in the upper
 *  part of the line, not down at the baseline). */
function isMarkGroup(group: Stroke[], em: number, lineMinY: number): boolean {
  const b = groupBounds(group);
  if (b.maxX < b.minX) return false; // empty
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (w > MARK_MAX_DIM_FRAC * em || h > MARK_MAX_DIM_FRAC * em) return false;
  return b.maxY - lineMinY <= MARK_TOP_FRAC * em;
}

/** Merge any dakuten-style mark group into the character to its left (see the
 *  MARK_* note above). Groups are left-to-right; a dakuten always trails its base
 *  kana, so it merges leftward. A leading mark (no left neighbour) is left as-is.
 *  No-op when the em is degenerate (all ink on one horizontal line). */
function mergeMarkGroups(groups: Stroke[][], all: Stroke[]): Stroke[][] {
  if (groups.length < 2) return groups;
  const em = drawingHeight(all);
  if (em < MARK_MIN_EM) return groups;
  let lineMinY = Infinity;
  for (const s of all) for (const p of s) if (p.y < lineMinY) lineMinY = p.y;

  const out: Stroke[][] = [];
  for (const g of groups) {
    if (out.length > 0 && isMarkGroup(g, em, lineMinY)) {
      out[out.length - 1] = out[out.length - 1].concat(g);
    } else {
      out.push(g);
    }
  }
  return out;
}

/**
 * Drop stray strokes (accidental dots/taps) before segmentation: a stroke that
 * is tiny relative to the em AND far from the union bbox of the non-tiny
 * strokes (see the STRAY_* note above). Pure and conservative:
 *   • with fewer than 2 strokes, or when every stroke is tiny, nothing is
 *     dropped (a deliberate 丶 or a just-started drawing must survive);
 *   • degenerate/zero-extent geometry (em below MARK_MIN_EM) is left alone,
 *     mirroring mergeMarkGroups.
 * Run BEFORE boundary prediction so junk can't skew the segmenter strip either.
 */
export function pruneStrayStrokes(strokes: Stroke[]): Stroke[] {
  const live = strokes.filter((s) => s.length > 0);
  if (live.length < 2) return strokes;
  const em = drawingHeight(live);
  if (em < MARK_MIN_EM) return strokes;

  const isTiny = (s: Stroke) => {
    const b = groupBounds([s]);
    return (
      b.maxX - b.minX < STRAY_MAX_DIM_FRAC * em &&
      b.maxY - b.minY < STRAY_MAX_DIM_FRAC * em
    );
  };
  const core = live.filter((s) => !isTiny(s));
  if (core.length === 0) return strokes;
  const cb = groupBounds(core);
  // Recompute the em from the real writing — a far stray below the line
  // inflates drawingHeight(live), which would also inflate the gap tolerance.
  const coreEm = Math.max(cb.maxY - cb.minY, MARK_MIN_EM);

  return live.filter((s) => {
    if (!isTiny(s)) return true;
    const b = groupBounds([s]);
    const gx = Math.max(0, Math.max(cb.minX - b.maxX, b.minX - cb.maxX));
    const gy = Math.max(0, Math.max(cb.minY - b.maxY, b.minY - cb.maxY));
    return Math.max(gx, gy) <= STRAY_GAP_FRAC * coreEm;
  });
}

/**
 * Group strokes into characters using boundary x-positions (drawing coords).
 *
 * A stroke joins the character whose x-interval contains its centroid: the
 * count of boundaries to the left of the centroid is its character index.
 * Returns groups left-to-right, skipping any character interval that caught no
 * strokes. With no boundaries, all strokes form a single group. Finally, any
 * dakuten-style mark group is merged into the character it belongs to.
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
  return mergeMarkGroups(groups.filter((g) => g.length > 0), live);
}
