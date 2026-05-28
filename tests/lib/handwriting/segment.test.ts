import { describe, it, expect } from "vitest";
import {
  segmentStrokes,
  splitGroupAtLargestGap,
} from "../../../app/lib/handwriting/segment";
import type { Stroke } from "../../../app/lib/handwriting/types";

// ───────────────────────────────────────────────────────────────────
// Stroke helpers. Coordinates are in arbitrary canvas units — the
// segmenter normalises by overall y-span, so absolute scale only
// matters relative to itself within one fixture.
// ───────────────────────────────────────────────────────────────────

/** Single horizontal stroke spanning `[x0, x1]` at the given y. */
function hLine(x0: number, x1: number, y: number): Stroke {
  return [
    { x: x0, y },
    { x: x1, y },
  ];
}

/** Single vertical stroke spanning `[y0, y1]` at the given x. */
function vLine(x: number, y0: number, y1: number): Stroke {
  return [
    { x, y: y0 },
    { x, y: y1 },
  ];
}

/** Rectangle-like 4-stroke "kanji" centred at (cx, cy) with size s. Crude
 *  stand-in for a real character: bounds are exactly cx±s/2, cy±s/2. */
function fakeKanji(cx: number, cy: number, s: number): Stroke[] {
  const half = s / 2;
  return [
    hLine(cx - half, cx + half, cy - half),
    vLine(cx + half, cy - half, cy + half),
    hLine(cx + half, cx - half, cy + half),
    vLine(cx - half, cy + half, cy - half),
  ];
}

describe("segmentStrokes", () => {
  it("returns an empty array for empty input", () => {
    expect(segmentStrokes([])).toEqual([]);
  });

  it("returns one group for a single stroke", () => {
    const s = hLine(0, 100, 50);
    const out = segmentStrokes([s]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([s]);
  });

  it("treats 三 (three horizontal strokes stacked) as one character", () => {
    // All three strokes span the same x range — no gap, can't split.
    const strokes: Stroke[] = [
      hLine(0, 100, 10),
      hLine(0, 100, 50),
      hLine(0, 100, 90),
    ];
    expect(segmentStrokes(strokes)).toHaveLength(1);
  });

  it("treats 川 (three roughly-equal vertical strokes) as one character", () => {
    // Three vertical lines at x = 10, 50, 90 spanning the full height.
    // Inter-stroke gap is ~40 (per stroke) but full height is 100, so
    // gap/H ≈ 0.4 — sits *at* the largeGapFrac threshold. The merged
    // aspect ratio at the third stroke is ~100/100 = 1.0, well under the
    // 1.3 aspect threshold, so the heuristic should keep it as one cluster.
    const strokes: Stroke[] = [
      vLine(10, 0, 100),
      vLine(50, 0, 100),
      vLine(90, 0, 100),
    ];
    const out = segmentStrokes(strokes);
    expect(out).toHaveLength(1);
  });

  it("splits two square kanji written side-by-side", () => {
    // Two 100-unit-wide square kanji, ~30 unit gap between them. Each
    // cluster on its own is ~1.0 aspect; the merged width would be 230
    // against a height of 100 (aspect 2.3) — well past the threshold,
    // and the gap is comfortably above minGapFrac * 100.
    const first = fakeKanji(50, 50, 100);
    const second = fakeKanji(180, 50, 100);
    const out = segmentStrokes([...first, ...second]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(first.length);
    expect(out[1]).toHaveLength(second.length);
  });

  it("preserves original drawing order within each cluster", () => {
    // Draw second kanji's strokes interleaved with first kanji's.
    const left = fakeKanji(50, 50, 100);
    const right = fakeKanji(200, 50, 100);
    // Interleaved input: l0, r0, l1, r1, l2, r2, l3, r3.
    const interleaved: Stroke[] = [];
    for (let i = 0; i < left.length; i++) {
      interleaved.push(left[i], right[i]);
    }
    const out = segmentStrokes(interleaved);
    expect(out).toHaveLength(2);
    // Each cluster comes back with its strokes in their original
    // (interleaved) submission order — the same set as the source kanji
    // but ordered by index in the input list.
    expect(out[0]).toEqual(left);
    expect(out[1]).toEqual(right);
  });

  it("splits even at a small gap when the merged aspect ratio exceeds the threshold", () => {
    // Two clusters of horizontal strokes with a modest inter-cluster gap.
    // Each cluster spans ~100 wide × 100 tall (square-ish).
    const left: Stroke[] = [
      hLine(0, 100, 10),
      hLine(0, 100, 90),
      vLine(0, 0, 100),
      vLine(100, 0, 100),
    ];
    const right: Stroke[] = [
      hLine(130, 230, 10),
      hLine(130, 230, 90),
      vLine(130, 0, 100),
      vLine(230, 0, 100),
    ];
    // Inter-cluster gap is 30 / 100 = 0.30 — over minGapFrac (0.15) but
    // under largeGapFrac (0.4). Aspect ratio at merge: 230/100 = 2.3 — over
    // the 1.3 threshold. Expect a split.
    expect(segmentStrokes([...left, ...right])).toHaveLength(2);
  });
});

describe("splitGroupAtLargestGap", () => {
  it("returns null for an empty or single-stroke group", () => {
    expect(splitGroupAtLargestGap([])).toBeNull();
    expect(splitGroupAtLargestGap([hLine(0, 10, 5)])).toBeNull();
  });

  it("returns null when every stroke overlaps its neighbours horizontally", () => {
    // Two strokes covering the same x range — no clean cut.
    const strokes: Stroke[] = [hLine(0, 100, 10), hLine(0, 100, 90)];
    expect(splitGroupAtLargestGap(strokes)).toBeNull();
  });

  it("splits at the widest gap", () => {
    // Three vertical strokes at x = 10, 50, 200. Widest gap is between
    // 50 and 200 — the split should put stroke 0+1 on the left and
    // stroke 2 on the right.
    const a = vLine(10, 0, 100);
    const b = vLine(50, 0, 100);
    const c = vLine(200, 0, 100);
    const out = splitGroupAtLargestGap([a, b, c]);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(2);
    expect(out![0]).toEqual([a, b]);
    expect(out![1]).toEqual([c]);
  });

  it("preserves original drawing order within each half", () => {
    // Two square kanji submitted with their strokes interleaved.
    const left = fakeKanji(50, 50, 100);
    const right = fakeKanji(250, 50, 100);
    const interleaved: Stroke[] = [];
    for (let i = 0; i < left.length; i++) {
      interleaved.push(left[i], right[i]);
    }
    const out = splitGroupAtLargestGap(interleaved);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(2);
    expect(out![0]).toEqual(left);
    expect(out![1]).toEqual(right);
  });
});
