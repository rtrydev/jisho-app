import { describe, it, expect } from "vitest";
import {
  coreGain,
  gateByCoarse,
  mapRegionToNative,
} from "../../../app/lib/handwriting/imagePreprocess";

// Pure cores of the photo-mode fixes (PHOTO_PRINT_FINDINGS.md): per-cell
// intensity re-normalization (coreGain) and native-resolution cell cutting
// (mapRegionToNative + gateByCoarse). The canvas-dependent orchestration
// (normalizeCell / nativeCell) is exercised in the browser, not here.

describe("coreGain — cell intensity re-normalization", () => {
  it("boosts a low-contrast cell so its core reads ≈1.0", () => {
    // A washed-out photo: component ink clusters around 0.5.
    const samples = [0.42, 0.45, 0.48, 0.5, 0.5, 0.52, 0.55];
    const gain = coreGain(samples);
    expect(gain).toBeGreaterThan(1.7);
    expect(gain).toBeLessThan(2.1);
    // Applying the gain puts the core at ~1 without overshooting far.
    expect(0.52 * gain).toBeGreaterThan(0.9);
    expect(0.52 * gain).toBeLessThanOrEqual(1.05);
  });

  it("passes full-contrast input through unchanged (gain = 1)", () => {
    expect(coreGain([0.96, 0.98, 1, 1, 1])).toBe(1);
  });

  it("never dims (gain ≥ 1 even for an implausibly bright core)", () => {
    expect(coreGain([1, 1, 1])).toBe(1);
  });

  it("returns 1 for no samples", () => {
    expect(coreGain([])).toBe(1);
  });

  it("is bounded by 1/INK_THRESH for degenerate faint input", () => {
    // Samples below the component threshold can't occur in practice; even if
    // they did, the gain must stay bounded (no noise amplification cliff).
    expect(coreGain([0.05, 0.06, 0.07])).toBeLessThanOrEqual(1 / 0.18 + 1e-9);
  });

  it("keys on the high percentile, not the max (a lone dark pixel cannot suppress the correction)", () => {
    // 49 washed-out pixels + 1 fully dark one: p95 sits in the washed-out
    // cluster, so the cell still gets boosted.
    const samples = [...Array(49).fill(0.5), 1.0];
    expect(coreGain(samples)).toBeGreaterThan(1.7);
  });
});

describe("mapRegionToNative — region mapping for native cell cuts", () => {
  it("scales the region and adds an em-relative background margin", () => {
    const { inner, outer } = mapRegionToNative(
      { x0: 10, x1: 20, y0: 30, y1: 40 },
      3, 3, 10, 1000, 1000,
    );
    expect(inner).toEqual({ x0: 30, x1: 60, y0: 90, y1: 120 });
    // margin = round(0.3 · em(10) · k(3)) = 9
    expect(outer).toEqual({ x0: 21, x1: 69, y0: 81, y1: 129 });
  });

  it("clamps both boxes to the image bounds", () => {
    const { inner, outer } = mapRegionToNative(
      { x0: 0, x1: 20, y0: 0, y1: 40 },
      3, 3, 10, 50, 100,
    );
    expect(inner).toEqual({ x0: 0, x1: 50, y0: 0, y1: 100 });
    expect(outer).toEqual({ x0: 0, x1: 50, y0: 0, y1: 100 });
  });

  it("handles fractional scale factors (independent x/y rounding)", () => {
    const { inner } = mapRegionToNative(
      { x0: 3, x1: 7, y0: 3, y1: 7 },
      2.5, 3.5, 4, 1000, 1000,
    );
    expect(inner).toEqual({
      x0: Math.floor(3 * 2.5),
      x1: Math.ceil(7 * 2.5),
      y0: Math.floor(3 * 3.5),
      y1: Math.ceil(7 * 3.5),
    });
  });
});

describe("gateByCoarse — coarse-map support gate for native re-extraction", () => {
  // Coarse map 4×4 with ink only at (0,0); native crop 12×12 at origin (0,0),
  // k=3, uncapped (step=1). Native pixel (x,y) maps to scaled
  // (floor((x+0.5)/3), …): x ∈ [0,5] → sx ∈ {0,1} (inside the 3×3
  // neighborhood of (0,0)); x ≥ 6 → sx ≥ 2 (outside).
  const cw = 4;
  const ch = 4;
  const coarse = new Float32Array(cw * ch);
  coarse[0] = 0.7;

  function nativeInk(): Float32Array {
    return new Float32Array(12 * 12).fill(0.9);
  }

  it("keeps native ink supported by the cleaned coarse map (with 3×3 slack)", () => {
    const out = gateByCoarse(nativeInk(), 12, 12, 0, 0, 1, 1, 3, 3, coarse, cw, ch);
    expect(out[0]).toBeCloseTo(0.9); // (0,0) → scaled (0,0), direct support
    expect(out[5 * 12 + 5]).toBeCloseTo(0.9); // (5,5) → scaled (1,1), neighborhood
  });

  it("zeroes native ink the global cleanup had removed", () => {
    const out = gateByCoarse(nativeInk(), 12, 12, 0, 0, 1, 1, 3, 3, coarse, cw, ch);
    expect(out[6]).toBe(0); // (6,0) → scaled (2,0), outside the neighborhood
    expect(out[7 * 12 + 7]).toBe(0); // (7,7) → scaled (2,2)
  });

  it("only zeroes — kept ink values are untouched, input is not mutated", () => {
    const ink = nativeInk();
    ink[0] = 0.42;
    const out = gateByCoarse(ink, 12, 12, 0, 0, 1, 1, 3, 3, coarse, cw, ch);
    expect(out[0]).toBeCloseTo(0.42);
    expect(ink[7 * 12 + 7]).toBeCloseTo(0.9); // original untouched
  });

  it("honors origin and step when the crop was capped", () => {
    // step=2: crop-local (x,y) covers native (2x+1, 2y+1) centers; origin
    // (12,12) shifts everything by 4 scaled px at k=3. Crop-local (0,0) →
    // native (13,13) → scaled (4,4): far from coarse ink at (0,0) → zeroed.
    const out = gateByCoarse(nativeInk(), 12, 12, 12, 12, 2, 2, 3, 3, coarse, cw, ch);
    expect(out[0]).toBe(0);
  });
});
