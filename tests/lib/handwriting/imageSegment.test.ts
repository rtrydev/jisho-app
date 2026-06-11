import { describe, it, expect } from "vitest";
import {
  segmentGrid,
  type Bbox,
  type ReadAxis,
} from "../../../app/lib/handwriting/imagePreprocess";

// segmentGrid is the pure multi-line core of the camera pipeline: cleaned ink
// map → one region per character, in reading order. These tests build ink maps
// directly (solid glyph squares are enough — glyph *shape* is normalizeCell's
// and the recognizer's problem), so no canvas is needed.

/** Build a w×h ink map (ink=1) with solid rectangles [x0,x1)×[y0,y1). */
function inkMap(w: number, h: number, rects: Bbox[]): Float32Array {
  const ink = new Float32Array(w * h);
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) ink[y * w + x] = 1;
    }
  }
  return ink;
}

function rect(x0: number, x1: number, y0: number, y1: number): Bbox {
  return { x0, x1, y0, y1 };
}

function center(b: Bbox): { cx: number; cy: number } {
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };
}

/** True when `region` contains the glyph's center (segmentation cuts land in
 *  gaps, so exact region edges aren't asserted — containment of centers is the
 *  contract that matters for reading order). */
function covers(region: Bbox, glyph: Bbox): boolean {
  const { cx, cy } = center(glyph);
  return cx >= region.x0 && cx < region.x1 && cy >= region.y0 && cy < region.y1;
}

function run(w: number, h: number, rects: Bbox[], axis: ReadAxis) {
  return segmentGrid(inkMap(w, h, rects), w, h, axis);
}

describe("segmentGrid — single line (previous behaviour preserved)", () => {
  it("splits a horizontal line into characters left-to-right", () => {
    const glyphs = [rect(20, 80, 20, 80), rect(110, 170, 20, 80), rect(200, 260, 20, 80)];
    const { regions, em } = run(300, 100, glyphs, "h");
    expect(regions).toHaveLength(3);
    glyphs.forEach((g, i) => expect(covers(regions[i], g)).toBe(true));
    expect(em).toBeGreaterThanOrEqual(55);
    expect(em).toBeLessThanOrEqual(70);
  });

  it("splits a vertical column into characters top-to-bottom", () => {
    const glyphs = [rect(20, 80, 20, 80), rect(20, 80, 110, 170), rect(20, 80, 200, 260)];
    const { regions } = run(100, 300, glyphs, "v");
    expect(regions).toHaveLength(3);
    glyphs.forEach((g, i) => expect(covers(regions[i], g)).toBe(true));
  });

  it("returns nothing for an empty map", () => {
    const { regions, em } = run(100, 100, [], "h");
    expect(regions).toEqual([]);
    expect(em).toBe(0);
  });
});

describe("segmentGrid — multi-line", () => {
  it("reads horizontal lines top-to-bottom, characters left-to-right", () => {
    // 2×2 grid of glyphs: two lines of two characters.
    const tl = rect(20, 80, 10, 70);
    const tr = rect(110, 170, 10, 70);
    const bl = rect(20, 80, 100, 160);
    const br = rect(110, 170, 100, 160);
    const { regions } = run(200, 180, [tl, tr, bl, br], "h");
    expect(regions).toHaveLength(4);
    // Reading order: top line left→right, then bottom line left→right.
    expect(covers(regions[0], tl)).toBe(true);
    expect(covers(regions[1], tr)).toBe(true);
    expect(covers(regions[2], bl)).toBe(true);
    expect(covers(regions[3], br)).toBe(true);
  });

  it("reads vertical columns right-to-left, characters top-to-bottom", () => {
    const leftTop = rect(20, 80, 10, 70);
    const leftBottom = rect(20, 80, 100, 160);
    const rightTop = rect(110, 170, 10, 70);
    const rightBottom = rect(110, 170, 100, 160);
    const { regions } = run(200, 180, [leftTop, leftBottom, rightTop, rightBottom], "v");
    expect(regions).toHaveLength(4);
    // Tategaki: the RIGHT column is read first.
    expect(covers(regions[0], rightTop)).toBe(true);
    expect(covers(regions[1], rightBottom)).toBe(true);
    expect(covers(regions[2], leftTop)).toBe(true);
    expect(covers(regions[3], leftBottom)).toBe(true);
  });

  it("keeps lines with very different character counts (sparse next to dense)", () => {
    // Top line: 4 characters; bottom line: a single character. The bottom
    // line's row-mass is ~4× lower — it must not be thresholded away.
    const top = [0, 1, 2, 3].map((i) => rect(20 + i * 90, 80 + i * 90, 10, 70));
    const lone = rect(20, 80, 100, 160);
    const { regions } = run(400, 180, [...top, lone], "h");
    expect(regions).toHaveLength(5);
    expect(covers(regions[4], lone)).toBe(true);
  });

  it("drops a clipped line touching the crop edge, keeps framed lines", () => {
    // The guide box sliced through the line above: a thin band at y=0.
    const clipped = [rect(20, 80, 0, 14), rect(110, 170, 0, 14)];
    const line1 = [rect(20, 80, 40, 100), rect(110, 170, 40, 100)];
    const line2 = [rect(20, 80, 130, 190), rect(110, 170, 130, 190)];
    const { regions } = run(200, 210, [...clipped, ...line1, ...line2], "h");
    expect(regions).toHaveLength(4);
    for (const region of regions) {
      // Nothing from the clipped band survives.
      expect(region.y0).toBeGreaterThan(20);
    }
  });

  it("keeps a thin INTERIOR band (a line of bar-kanji is legitimately thin)", () => {
    // Middle line is 一二 — its ink band is much thinner than the others, but
    // it doesn't touch a crop edge, so it must survive.
    const line1 = [rect(20, 80, 20, 80), rect(110, 170, 20, 80)];
    const bars = [rect(20, 80, 130, 142), rect(110, 170, 130, 142)];
    const line3 = [rect(20, 80, 190, 250), rect(110, 170, 190, 250)];
    const { regions } = run(200, 280, [...line1, ...bars, ...line3], "h");
    expect(regions).toHaveLength(6);
    expect(covers(regions[2], bars[0])).toBe(true);
    expect(covers(regions[3], bars[1])).toBe(true);
  });
});

describe("segmentGrid — junk pruning", () => {
  it("prunes glyph-relative specks (between lines and beside characters)", () => {
    const g1 = rect(20, 80, 20, 80);
    const g2 = rect(110, 170, 20, 80);
    const g3 = rect(20, 80, 130, 190);
    const specks = [
      rect(140, 142, 105, 107), // in the line gap
      rect(90, 92, 40, 42), // between the two glyphs of line 1
      rect(120, 122, 200, 202), // below everything
    ];
    const { regions, ink } = run(200, 220, [g1, g2, g3, ...specks], "h");
    expect(regions).toHaveLength(3);
    // The speck pixels were zeroed in the returned ink map.
    for (const s of specks) {
      expect(ink[s.y0 * 200 + s.x0]).toBe(0);
    }
    // ...and no region grew to swallow a speck location.
    for (const region of regions) {
      for (const s of specks) expect(covers(region, s)).toBe(false);
    }
  });

  it("does NOT prune dakuten-sized marks (well above the speck cut)", () => {
    // A kana with a dakuten-ish pair of ~6×12 marks tucked into the top of its
    // em box (print typesets dakuten inside the glyph square, overlapping the
    // base's x-range).
    const base = rect(20, 70, 20, 80);
    const marks = [rect(50, 56, 8, 20), rect(60, 66, 4, 16)];
    const { regions, ink } = run(140, 100, [base, ...marks], "h");
    // Marks survive the pruning…
    expect(ink[10 * 140 + 52]).toBe(1);
    // …and stay inside the (single) character region, not as extra cells.
    expect(regions).toHaveLength(1);
    expect(covers(regions[0], marks[0])).toBe(true);
  });
});
