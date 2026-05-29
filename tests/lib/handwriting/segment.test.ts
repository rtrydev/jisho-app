import { describe, it, expect } from "vitest";
import { splitStrokesByBoundaries } from "../../../app/lib/handwriting/segment";
import type { Stroke } from "../../../app/lib/handwriting/types";

// A stroke is just a list of points; the splitter only looks at each stroke's
// horizontal centroid relative to the boundary x-positions. Helper builds a
// 1-point stroke at a given x (centroid = x) so assignment is unambiguous.
function at(x: number): Stroke {
  return [{ x, y: 0 }];
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
    // A stroke whose points straddle the boundary but whose mean is left of it.
    const straddling: Stroke = [
      { x: 60, y: 0 },
      { x: 90, y: 10 },
    ]; // centroid x = 75
    const out = splitStrokesByBoundaries([straddling, at(140)], [80]);
    expect(out).toEqual([[straddling], [at(140)]]);
  });

  it("ignores empty strokes", () => {
    const empty: Stroke = [];
    const out = splitStrokesByBoundaries([empty, at(10), at(200)], [100]);
    expect(out).toEqual([[at(10)], [at(200)]]);
  });
});
