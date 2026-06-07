import { describe, it, expect } from "vitest";
import { looksLikeGlyph } from "../../../app/lib/handwriting/imagePreprocess";
import {
  topKMass,
  hasGlyphStructure,
  filterGlyphGroups,
} from "../../../app/lib/handwriting/glyphConfidence";
import type { Candidate } from "../../../app/lib/handwriting/types";

const SIZE = 96;

/** Build a SIZE×SIZE ink map and fill a rectangle [x0,x1)×[y0,y1) with ink. */
function cellWithRect(x0: number, x1: number, y0: number, y1: number): Float32Array {
  const c = new Float32Array(SIZE * SIZE);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) c[y * SIZE + x] = 1;
  }
  return c;
}

describe("looksLikeGlyph (structural text-presence gate)", () => {
  it("rejects an empty cell", () => {
    expect(looksLikeGlyph(new Float32Array(SIZE * SIZE))).toBe(false);
  });

  it("rejects a tiny speck of leftover noise", () => {
    expect(looksLikeGlyph(cellWithRect(40, 45, 40, 45))).toBe(false); // 25px ≈ 0.27%
  });

  it("rejects a solid 2-D filled region (a dark object / blob)", () => {
    expect(looksLikeGlyph(cellWithRect(20, 76, 20, 76))).toBe(false); // 56×56 fully filled
  });

  it("accepts sparse strokes that span both axes (a real kanji)", () => {
    // A plus sign: a horizontal and a vertical band crossing the middle. Spans
    // both axes (2-D) but fills only a small fraction of its bbox.
    const c = new Float32Array(SIZE * SIZE);
    for (let y = 10; y < 86; y++) for (let x = 46; x < 50; x++) c[y * SIZE + x] = 1;
    for (let x = 10; x < 86; x++) for (let y = 46; y < 50; y++) c[y * SIZE + x] = 1;
    expect(looksLikeGlyph(c)).toBe(true);
  });

  it("accepts a solid-but-thin line kanji (一) — the 2-D guard spares it", () => {
    // Full-width, only a few rows tall: its bbox is filled, but the box is thin
    // on one axis, so the "solid blob" test doesn't fire.
    expect(looksLikeGlyph(cellWithRect(8, 89, 46, 50))).toBe(true);
  });

  it("accepts the chōonpu ー and thin vertical kana strokes (one-axis bands)", () => {
    expect(looksLikeGlyph(cellWithRect(8, 89, 46, 50))).toBe(true); // ー (horizontal)
    expect(looksLikeGlyph(cellWithRect(46, 50, 8, 89))).toBe(true); // | (vertical)
  });

  it("accepts a sparse diagonal kana stroke (し / ノ)", () => {
    // A single ~4px-wide diagonal band corner-to-corner: spans both axes but
    // fills only a few percent of its bbox, so it's neither empty nor a blob.
    const c = new Float32Array(SIZE * SIZE);
    for (let t = 8; t < 88; t++) {
      for (let w = -2; w < 2; w++) {
        const x = t + w;
        if (x >= 0 && x < SIZE) c[t * SIZE + x] = 1;
      }
    }
    expect(looksLikeGlyph(c)).toBe(true);
  });
});

describe("glyphConfidence (recognizer-side text-presence gate)", () => {
  const cand = (char: string, score: number): Candidate => ({
    char,
    score,
    classIndex: 0,
  });

  it("sums the top-K mass", () => {
    expect(topKMass([cand("日", 0.1), cand("目", 0.05), cand("田", 0.02)])).toBeCloseTo(
      0.17,
    );
    expect(topKMass([])).toBe(0);
  });

  it("keeps a genuine low-confidence read (mass well above the floor)", () => {
    // A correct kanji can peak at ~0.05 but still concentrates mass on neighbours.
    const group = [cand("日", 0.05), cand("目", 0.04), cand("田", 0.03), cand("旦", 0.02)];
    expect(hasGlyphStructure(group)).toBe(true);
  });

  it("rejects a near-uniform spread (no character — random photo region)", () => {
    // 12 candidates each ~1/5454 → top-K mass ≈ 0.0026, far below the floor.
    const group = Array.from({ length: 12 }, (_, i) => cand(`x${i}`, 1 / 5454));
    expect(hasGlyphStructure(group)).toBe(false);
  });

  it("rejects an empty group", () => {
    expect(hasGlyphStructure([])).toBe(false);
  });

  it("filterGlyphGroups drops only the structureless groups", () => {
    const real = [cand("日", 0.08), cand("目", 0.05)];
    const noise = Array.from({ length: 12 }, (_, i) => cand(`x${i}`, 1 / 5454));
    expect(filterGlyphGroups([real, noise, []])).toEqual([real]);
  });
});
