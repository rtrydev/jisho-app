import { describe, it, expect } from "vitest";
import {
  filterBoundariesByStrokes,
  pruneStrayStrokes,
  splitStrokesByBoundaries,
} from "../../../app/lib/handwriting/segment";
import type { Stroke } from "../../../app/lib/handwriting/types";

// A stroke is just a list of points; the splitter looks at each stroke's
// horizontal centroid relative to the boundary x-positions, after vetoing any
// boundary a stroke crosses. Helper builds a 1-point stroke at a given x
// (centroid = x; a single point can never straddle a boundary) so assignment is
// unambiguous.
function at(x: number): Stroke {
  return [{ x, y: 0 }];
}

/** A horizontal stroke from x0..x1 at height y (≥2 points so it has extent). */
function hline(x0: number, x1: number, y: number): Stroke {
  return [
    { x: x0, y },
    { x: x1, y },
  ];
}

/** A 2-point stroke between two corners. */
function seg(x0: number, y0: number, x1: number, y1: number): Stroke {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];
}

describe("splitStrokesByBoundaries", () => {
  it("returns an empty array for no strokes", () => {
    expect(splitStrokesByBoundaries([], [])).toEqual([]);
    expect(splitStrokesByBoundaries([], [50])).toEqual([]);
  });

  it("returns a single group when there are no boundaries", () => {
    const s = [at(10), at(20), at(30)];
    const out = splitStrokesByBoundaries(s, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(s);
  });

  it("splits strokes into characters by centroid relative to a boundary", () => {
    const a = at(10);
    const b = at(40);
    const c = at(120);
    const d = at(150);
    // Boundary at x=80 → {a,b} | {c,d}
    const out = splitStrokesByBoundaries([a, b, c, d], [80]);
    expect(out).toEqual([
      [a, b],
      [c, d],
    ]);
  });

  it("handles multiple boundaries (3 characters)", () => {
    const out = splitStrokesByBoundaries(
      [at(10), at(60), at(110), at(210)],
      [50, 150],
    );
    expect(out).toEqual([[at(10)], [at(60), at(110)], [at(210)]]);
  });

  it("skips character intervals that caught no strokes", () => {
    // Boundaries at 50 and 150, but nothing lands in the middle interval.
    const out = splitStrokesByBoundaries([at(10), at(200)], [50, 150]);
    expect(out).toEqual([[at(10)], [at(200)]]);
  });

  it("orders groups left-to-right and is unaffected by stroke order", () => {
    const left = at(10);
    const right = at(200);
    const out = splitStrokesByBoundaries([right, left], [100]);
    expect(out).toEqual([[left], [right]]);
  });

  it("uses the mean x as the centroid for multi-point strokes", () => {
    // A multi-point stroke confined to one side of the boundary is assigned as a
    // unit by its mean x (here 65 < 80). It doesn't reach across the boundary,
    // so the boundary survives the stroke-crossing veto.
    const onesided: Stroke = [
      { x: 60, y: 0 },
      { x: 70, y: 10 },
    ]; // centroid x = 65
    const out = splitStrokesByBoundaries([onesided, at(140)], [80]);
    expect(out).toEqual([[onesided], [at(140)]]);
  });

  it("ignores empty strokes", () => {
    const empty: Stroke = [];
    const out = splitStrokesByBoundaries([empty, at(10), at(200)], [100]);
    expect(out).toEqual([[at(10)], [at(200)]]);
  });
});

describe("filterBoundariesByStrokes (stroke-crossing veto)", () => {
  it("keeps boundaries that no stroke crosses", () => {
    // 一一: two strokes, each confined to its own half; the gap between them is
    // a real break crossed by neither.
    const left = hline(0, 80, 0);
    const right = hline(120, 200, 0);
    expect(filterBoundariesByStrokes([left, right], [100])).toEqual([100]);
  });

  it("drops a boundary that a stroke spans on both sides", () => {
    // 二: two full-width horizontal strokes; an internal cut is crossed by both.
    const top = hline(0, 200, 0);
    const bottom = hline(0, 200, 40);
    expect(filterBoundariesByStrokes([top, bottom], [100])).toEqual([]);
  });

  it("drops every phantom boundary inside one wide character", () => {
    const top = hline(0, 240, 0);
    const bottom = hline(0, 240, 30);
    expect(filterBoundariesByStrokes([top, bottom], [60, 120, 180])).toEqual([]);
  });

  it("tolerates minor overshoot into the gap (tol scales with height)", () => {
    // The left char's stroke overshoots a few px past the break; the break still
    // stands because the overshoot stays within tolerance.
    // y-extent 0..40 → tol = 0.15 * 40 = 6, so boundary 80 has band 74..86.
    const left: Stroke = [
      { x: 0, y: 0 },
      { x: 84, y: 40 },
    ]; // reaches x=84 — past 80 but inside the 86 tolerance edge → not a cross
    const right = hline(120, 200, 0);
    expect(filterBoundariesByStrokes([left, right], [80])).toEqual([80]);
  });

  it("merges a wide character end-to-end through the splitter", () => {
    const top = hline(0, 200, 0);
    const bottom = hline(0, 200, 40);
    const out = splitStrokesByBoundaries([top, bottom], [100]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([top, bottom]);
  });
});

describe("dakuten mark-merge veto (kana)", () => {
  // em = drawing height = 100 in these cases (so MARK thresholds are 34 / 55 px).
  it("merges a high, tiny mark group (dakuten) into the character on its left", () => {
    // が: base kana spanning the full em on the left, two tiny marks up top-right.
    const base1 = seg(0, 0, 40, 100);
    const base2 = seg(10, 20, 50, 90);
    const dakuten1 = seg(70, 0, 78, 8); // w8 h8, top of the line
    const dakuten2 = seg(82, 2, 90, 10);
    // The segmenter fires a phantom boundary between the body and the marks.
    const out = splitStrokesByBoundaries(
      [base1, base2, dakuten1, dakuten2],
      [65],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4); // all four strokes in one character
  });

  it("does NOT merge two full-height characters", () => {
    const a = seg(0, 0, 60, 100);
    const b = seg(120, 0, 180, 100);
    const out = splitStrokesByBoundaries([a, b], [90]);
    expect(out).toEqual([[a], [b]]);
  });

  it("does NOT merge a small mark sitting low at the baseline (punctuation)", () => {
    // A tiny but LOW component fails the "high" test, so it stays its own group.
    const a = seg(0, 0, 60, 100);
    const low = seg(70, 88, 80, 98);
    const out = splitStrokesByBoundaries([a, low], [65]);
    expect(out).toEqual([[a], [low]]);
  });

  it("does NOT merge a wide trailing stroke (chōonpu ー)", () => {
    // ー is mark-height but spans far more than MARK_MAX_DIM_FRAC of the em wide.
    const a = seg(0, 0, 60, 100);
    const choon = hline(80, 180, 40);
    const out = splitStrokesByBoundaries([a, choon], [70]);
    expect(out).toEqual([[a], [choon]]);
  });
});

describe("pruneStrayStrokes (accidental-dot veto)", () => {
  // A character occupying the upper-left of a ~300px canvas; em (core height)
  // is 150, so tiny = dims < 15 and far = gap > 45.
  const body1 = seg(50, 50, 200, 200);
  const body2 = seg(50, 200, 200, 50);

  it("drops a tiny stroke far from the writing (palm graze in a corner)", () => {
    const stray = seg(290, 290, 294, 294);
    expect(pruneStrayStrokes([body1, body2, stray])).toEqual([body1, body2]);
  });

  it("keeps a tiny stroke near the character (dakuten / the dot of 犬)", () => {
    const dakuten = seg(210, 60, 222, 72); // 10px to the right of the body
    const dot = seg(160, 40, 170, 48); // just above it
    expect(pruneStrayStrokes([body1, body2, dakuten, dot])).toEqual([
      body1,
      body2,
      dakuten,
      dot,
    ]);
  });

  it("never drops a non-tiny stroke, however far away (a second character)", () => {
    const second = seg(600, 50, 700, 200);
    expect(pruneStrayStrokes([body1, second])).toEqual([body1, second]);
  });

  it("leaves a lone stroke alone (a deliberate 丶)", () => {
    const dot = seg(150, 150, 156, 156);
    expect(pruneStrayStrokes([dot])).toEqual([dot]);
  });

  it("leaves an all-tiny drawing alone (a drawing that just started)", () => {
    const a = seg(100, 100, 106, 106);
    const b = seg(200, 200, 206, 206);
    expect(pruneStrayStrokes([a, b])).toEqual([a, b]);
  });

  it("leaves degenerate flat geometry alone (em below the floor)", () => {
    const flat1 = hline(0, 100, 10);
    const flat2 = hline(120, 130, 12); // small, but the em is ~2px — no basis to judge
    expect(pruneStrayStrokes([flat1, flat2])).toEqual([flat1, flat2]);
  });

  it("drops multiple strays in one pass (they can't shelter each other)", () => {
    const strayA = seg(280, 280, 286, 286);
    const strayB = seg(292, 292, 298, 298); // near strayA, far from the body
    expect(pruneStrayStrokes([body1, body2, strayA, strayB])).toEqual([
      body1,
      body2,
    ]);
  });
});
