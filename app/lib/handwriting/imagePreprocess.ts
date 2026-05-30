// Photo pixels → recognizer-ready 96×96 cells.
//
// This is the camera-mode counterpart to `preprocess.ts` (which rasterizes
// *vector strokes*). A photo crop can't reuse that path at all, so this module
// is the TS+Canvas port of the feasibility probe pipeline documented in
// `photo_probe/FINDINGS.md` (§3a foreground→glyph, §4 foreground extraction,
// §5 projection segmentation + leak filter). The reference implementation is
// `photo_probe/probe.py`; the constants and the ink=1/bg=0 convention are kept
// identical so accuracy matches the probe (the recognizer is edge-sharpness
// sensitive — §6).
//
// Pipeline, given a cropped guide-box ImageData and the reading axis:
//   1. (optional) downscale the crop so the pixel ops stay cheap on a phone
//   2. foreground extraction → soft ink map in [0,1], ink=1, bg=0
//   3. connected-component cleanup (drop frame-spanning rules + tiny specks)
//   4. mild Gaussian (σ≈0.5) to restore the anti-aliased edge the model expects
//   5. projection-profile segmentation along the reading axis → cells
//   6. geometric leak filter (drop sub-median edge cells)
//   7. normalize each cell to a 96×96 model input
//
// Orientation is NOT auto-detected here: the camera UI gives the user a manual
// horizontal/vertical guide-box toggle, so the reading axis is known and the
// one unreliable heuristic from the probe (aspect-ratio orientation on 1–2
// glyphs, §5) is sidestepped entirely.

import { HANDWRITING_INPUT_SIZE } from "./preprocess";

/** Reading axis. `h` → glyphs laid left-to-right, segment on x; `v` →
 *  top-to-bottom, segment on y. */
export type ReadAxis = "h" | "v";

/** Foreground extraction strategy (FINDINGS §4). `color` degrades gracefully
 *  to `bgdist` for monochrome text, so it is the safe default for arbitrary
 *  camera scenes; `otsu` is the cheap dark-on-light common case. */
export type ForegroundStrategy = "otsu" | "bgdist" | "color";

const INPUT_SIZE = HANDWRITING_INPUT_SIZE; // 96, shared with the stroke path
const MARGIN_FRAC = 0.12; // §3a — matches preprocess.ts + training rasterizer
const INK_THRESH = 0.18; // §3a/§4 — "ink" cutoff on the soft map
const GAP_FRAC = 0.1; // §5 — projection valley cut at 10% of the peak
const MIN_RUN_FRAC = 0.12; // §5 — drop runs < 12% of the longest (noise/slivers)
const SPECK_AREA_FRAC = 0.0008; // §4 — components smaller than this are specks
const LEAK_EDGE_FRAC = 0.5; // edge cell < 0.5× median extent → treat as a leak
// Light smoothing (as a fraction of glyph size) for the valley-snapping profile
// used by the pitch refinement — see refineByPitch / projectionRuns.
const SEG_SNAP_FRAC = 0.05;
const MAX_CROP_DIM = 1080; // downscale ceiling so the pixel ops stay cheap

// --------------------------------------------------------------------------- //
// canvas helpers (prefer OffscreenCanvas; fall back for older Safari)
// --------------------------------------------------------------------------- //

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

function ctx2d(canvas: AnyCanvas, willReadFrequently = false): AnyCtx | null {
  return canvas.getContext("2d", { willReadFrequently }) as AnyCtx | null;
}

// --------------------------------------------------------------------------- //
// 1. downscale
// --------------------------------------------------------------------------- //

/** Cap the long side at MAX_CROP_DIM. A phone frame crop can be ~1000px+; the
 *  glyphs end up resampled to 96px anyway, so working at full res only burns
 *  cycles. Returns the input untouched when already small enough. */
function maybeDownscale(image: ImageData): ImageData {
  const long = Math.max(image.width, image.height);
  if (long <= MAX_CROP_DIM) return image;
  const scale = MAX_CROP_DIM / long;
  const nw = Math.max(1, Math.round(image.width * scale));
  const nh = Math.max(1, Math.round(image.height * scale));
  const src = makeCanvas(image.width, image.height);
  const sctx = ctx2d(src);
  if (!sctx) return image;
  sctx.putImageData(image, 0, 0);
  const dst = makeCanvas(nw, nh);
  const dctx = ctx2d(dst, true);
  if (!dctx) return image;
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(src as CanvasImageSource, 0, 0, nw, nh);
  return dctx.getImageData(0, 0, nw, nh);
}

// --------------------------------------------------------------------------- //
// shared math
// --------------------------------------------------------------------------- //

/** Otsu threshold over a flat float array, binned to 0..255. Ported from
 *  `probe.py::otsu`. */
function otsu(values: Float32Array): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 1e-6) return lo;
  const hist = new Float64Array(256);
  const span = hi - lo;
  for (let i = 0; i < values.length; i++) {
    const bin = Math.round(((values[i] - lo) / span) * 255);
    hist[bin] += 1;
  }
  let total = 0;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) {
    total += hist[t];
    sumAll += t * hist[t];
  }
  let wB = 0;
  let sumB = 0;
  let bestT = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      bestT = t;
    }
  }
  return lo + (bestT / 255) * span;
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Per-channel median of the pixels in a border ring `bw` px thick. Used to
 *  estimate the background colour for the distance-based strategies. */
function borderMedian(image: ImageData): [number, number, number] {
  const { data, width: w, height: h } = image;
  const bw = Math.max(2, Math.round(0.1 * Math.min(w, h)));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onRing = y < bw || y >= h - bw || x < bw || x >= w - bw;
      if (onRing) push(x, y);
    }
  }
  const med = (a: number[]) => {
    a.sort((p, q) => p - q);
    return a.length ? a[a.length >> 1] : 0;
  };
  return [med(rs), med(gs), med(bs)];
}

// --------------------------------------------------------------------------- //
// 2. foreground extraction → soft ink map [0,1] (ink=1, bg=0)
// --------------------------------------------------------------------------- //

/** Dark-on-light via luminance Otsu (`probe.py::fg_otsu`). */
function fgOtsu(image: ImageData): Float32Array {
  const { data, width: w, height: h } = image;
  const n = w * h;
  const g = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    g[j] = luma(data[i], data[i + 1], data[i + 2]);
  }
  const t = otsu(g);
  let darkCount = 0;
  for (let j = 0; j < n; j++) if (g[j] < t) darkCount++;
  // If the dark class is the minority, the page is light-on-dark — invert so
  // "ink" is always the foreground class.
  const inkIsDark = darkCount / n <= 0.5 ? true : false;
  const ink = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const isInk = inkIsDark ? g[j] < t : g[j] >= t;
    if (!isInk) continue;
    // Soft ramp by distance past the threshold (toward black for dark ink).
    const soft = inkIsDark
      ? Math.min(1, Math.max(0, (t - g[j]) / Math.max(t, 1e-6)))
      : Math.min(1, Math.max(0, (g[j] - t) / Math.max(255 - t, 1e-6)));
    ink[j] = soft;
  }
  return ink;
}

/** Distance-to-background map + Otsu (`probe.py::fg_bgdist`). Returns both the
 *  soft ink map and the raw distance map (the colour strategy reuses dist). */
function bgDistMap(image: ImageData): { soft: Float32Array; dist: Float32Array; t: number } {
  const { data, width: w, height: h } = image;
  const n = w * h;
  const [br, bg, bb] = borderMedian(image);
  const dist = new Float32Array(n);
  let maxD = 0;
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    dist[j] = d;
    if (d > maxD) maxD = d;
  }
  const t = otsu(dist);
  const soft = new Float32Array(n);
  const denom = Math.max(maxD - t, 1e-6);
  for (let j = 0; j < n; j++) {
    soft[j] = Math.min(1, Math.max(0, (dist[j] - t) / denom));
  }
  return { soft, dist, t };
}

function fgBgDist(image: ImageData): Float32Array {
  return bgDistMap(image).soft;
}

/** Deterministic 2-means over RGB points (`probe.py::_kmeans2`). */
function kmeans2(pts: Float32Array, count: number): { cent: number[][]; assign: Uint8Array } {
  // init: the two extremes per channel
  const cmin = [Infinity, Infinity, Infinity];
  const cmax = [-Infinity, -Infinity, -Infinity];
  for (let p = 0; p < count; p++) {
    for (let c = 0; c < 3; c++) {
      const v = pts[p * 3 + c];
      if (v < cmin[c]) cmin[c] = v;
      if (v > cmax[c]) cmax[c] = v;
    }
  }
  const cent = [cmin.slice(), cmax.slice()];
  const assign = new Uint8Array(count);
  for (let iter = 0; iter < 20; iter++) {
    for (let p = 0; p < count; p++) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < 2; k++) {
        const dr = pts[p * 3] - cent[k][0];
        const dg = pts[p * 3 + 1] - cent[k][1];
        const db = pts[p * 3 + 2] - cent[k][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      assign[p] = best;
    }
    for (let k = 0; k < 2; k++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let cnt = 0;
      for (let p = 0; p < count; p++) {
        if (assign[p] !== k) continue;
        sr += pts[p * 3];
        sg += pts[p * 3 + 1];
        sb += pts[p * 3 + 2];
        cnt++;
      }
      if (cnt > 0) cent[k] = [sr / cnt, sg / cnt, sb / cnt];
    }
  }
  return { cent, assign };
}

/** Background-distance, then — only when the ink splits into two clearly
 *  distinct hues (e.g. red text + blue design band) — keep the text-coloured
 *  cluster (more connected components) and drop the other. Falls back to plain
 *  bgdist for monochrome text. Ported from `probe.py::fg_color`. */
function fgColor(image: ImageData): Float32Array {
  const { data, width: w, height: h } = image;
  const n = w * h;
  const { soft, dist, t } = bgDistMap(image);
  // Candidate ink pixels (above the distance threshold).
  const candIdx: number[] = [];
  for (let j = 0; j < n; j++) if (dist[j] > t) candIdx.push(j);
  if (candIdx.length < 32) return soft;
  const pts = new Float32Array(candIdx.length * 3);
  for (let p = 0; p < candIdx.length; p++) {
    const i = candIdx[p] * 4;
    pts[p * 3] = data[i];
    pts[p * 3 + 1] = data[i + 1];
    pts[p * 3 + 2] = data[i + 2];
  }
  const { cent, assign } = kmeans2(pts, candIdx.length);
  // Compare HUE (unit-normalized colour), not brightness — anti-aliasing splits
  // monochrome text into dark-core vs grey-edge clusters that are far in raw RGB
  // but share a hue. Only separate when the clusters are genuinely different
  // colours (§4).
  const norm = (c: number[]) => {
    const m = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) + 1e-6;
    return [c[0] / m, c[1] / m, c[2] / m];
  };
  const u0 = norm(cent[0]);
  const u1 = norm(cent[1]);
  const hueGap = Math.sqrt(
    (u0[0] - u1[0]) ** 2 + (u0[1] - u1[1]) ** 2 + (u0[2] - u1[2]) ** 2,
  );
  if (hueGap < 0.3) return soft; // one ink colour → keep all

  // Pick the cluster with more connected components (text shatters into many
  // glyph parts; a solid design band is one or few blobs).
  let bestK = 0;
  let bestComps = -1;
  for (let k = 0; k < 2; k++) {
    const mask = new Uint8Array(n);
    for (let p = 0; p < candIdx.length; p++) {
      if (assign[p] === k) mask[candIdx[p]] = 1;
    }
    const { count } = labelComponents(mask, w, h);
    if (count > bestComps) {
      bestComps = count;
      bestK = k;
    }
  }
  const keep = new Uint8Array(n);
  for (let p = 0; p < candIdx.length; p++) {
    if (assign[p] === bestK) keep[candIdx[p]] = 1;
  }
  const out = new Float32Array(n);
  for (let j = 0; j < n; j++) out[j] = keep[j] ? soft[j] : 0;
  return out;
}

const FOREGROUND: Record<ForegroundStrategy, (image: ImageData) => Float32Array> = {
  otsu: fgOtsu,
  bgdist: fgBgDist,
  color: fgColor,
};

// --------------------------------------------------------------------------- //
// 3. connected-component cleanup
// --------------------------------------------------------------------------- //

type Component = { area: number; x0: number; x1: number; y0: number; y1: number };

/** 4-connected component labelling over a binary mask, iterative flood fill.
 *  Returns the label image, component count, and per-component bbox + area. */
function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; count: number; comps: Component[] } {
  const labels = new Int32Array(w * h); // 0 = unlabelled
  const comps: Component[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    next++;
    labels[start] = next;
    stack.length = 0;
    stack.push(start);
    let area = 0;
    let x0 = w;
    let x1 = -1;
    let y0 = h;
    let y1 = -1;
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % w;
      const y = (idx - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      // 4-neighbours
      if (x > 0) {
        const nIdx = idx - 1;
        if (mask[nIdx] && labels[nIdx] === 0) {
          labels[nIdx] = next;
          stack.push(nIdx);
        }
      }
      if (x < w - 1) {
        const nIdx = idx + 1;
        if (mask[nIdx] && labels[nIdx] === 0) {
          labels[nIdx] = next;
          stack.push(nIdx);
        }
      }
      if (y > 0) {
        const nIdx = idx - w;
        if (mask[nIdx] && labels[nIdx] === 0) {
          labels[nIdx] = next;
          stack.push(nIdx);
        }
      }
      if (y < h - 1) {
        const nIdx = idx + w;
        if (mask[nIdx] && labels[nIdx] === 0) {
          labels[nIdx] = next;
          stack.push(nIdx);
        }
      }
    }
    comps.push({ area, x0, x1, y0, y1 });
  }
  return { labels, count: next, comps };
}

/** Drop components that bridge the whole frame while staying thin (rules /
 *  colour bands / page edges) or that are tiny specks. Mirrors
 *  `probe.py::clean_components`. Mutates a copy of `ink`. */
function cleanComponents(ink: Float32Array, w: number, h: number): Float32Array {
  const mask = new Uint8Array(ink.length);
  for (let j = 0; j < ink.length; j++) mask[j] = ink[j] > INK_THRESH ? 1 : 0;
  const { labels, comps } = labelComponents(mask, w, h);
  if (comps.length === 0) return ink;
  const out = ink.slice();
  const speck = SPECK_AREA_FRAC * w * h;
  const drop = new Uint8Array(comps.length + 1); // 1-indexed labels
  for (let c = 0; c < comps.length; c++) {
    const { area, x0, x1, y0, y1 } = comps[c];
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const spansW = x0 <= 1 && x1 >= w - 2 && ch < 0.5 * h;
    const spansH = y0 <= 1 && y1 >= h - 2 && cw < 0.5 * w;
    if (area < speck || spansW || spansH) drop[c + 1] = 1;
  }
  for (let j = 0; j < out.length; j++) {
    if (drop[labels[j]]) out[j] = 0;
  }
  return out;
}

// --------------------------------------------------------------------------- //
// 4. mild Gaussian (σ≈0.5) — restore the anti-aliased edge the model expects
// --------------------------------------------------------------------------- //

// Separable 3-tap kernel for σ=0.5 (g(0)=1, g(±1)=e^-2), normalized. The tail
// past ±1 is negligible (g(2)=e^-8≈3e-4).
const BLUR_KERNEL = (() => {
  const c = Math.exp(-2); // 0.13534
  const sum = 1 + 2 * c;
  return [c / sum, 1 / sum, c / sum];
})();

function blur05(ink: Float32Array, w: number, h: number): Float32Array {
  const k0 = BLUR_KERNEL[0];
  const k1 = BLUR_KERNEL[1];
  const tmp = new Float32Array(ink.length);
  // horizontal pass (reflect edges)
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = x > 0 ? ink[row + x - 1] : ink[row + x];
      const r = x < w - 1 ? ink[row + x + 1] : ink[row + x];
      tmp[row + x] = k0 * l + k1 * ink[row + x] + k0 * r;
    }
  }
  // vertical pass
  const out = new Float32Array(ink.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const u = y > 0 ? tmp[row - w + x] : tmp[row + x];
      const d = y < h - 1 ? tmp[row + w + x] : tmp[row + x];
      out[row + x] = k0 * u + k1 * tmp[row + x] + k0 * d;
    }
  }
  return out;
}

// --------------------------------------------------------------------------- //
// 5. projection-profile segmentation + leak filter
// --------------------------------------------------------------------------- //

type Bbox = { x0: number; x1: number; y0: number; y1: number };

function inkBbox(ink: Float32Array, w: number, h: number): Bbox | null {
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (ink[row + x] > INK_THRESH) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, x1: x1 + 1, y0, y1: y1 + 1 };
}

/** 1-D Gaussian smoothing with reflect edges. Radius tracks σ (3σ truncation —
 *  the tail beyond is <1.2%). */
function gaussian1d(profile: Float32Array, sigma: number): Float32Array {
  const radius = Math.max(1, Math.round(3 * sigma));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const n = profile.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      let s = i + k;
      if (s < 0) s = -s - 1; // reflect
      if (s >= n) s = 2 * n - s - 1;
      acc += profile[s] * kernel[k + radius];
    }
    out[i] = acc;
  }
  return out;
}

type Run = { a: number; b: number }; // [a, b) along the reading axis (bbox-local)

/** Projection-profile split (`probe.py::seg_proj`): ink mass along the reading
 *  axis, cut at valleys below GAP_FRAC×peak, dropping runs under MIN_RUN_FRAC of
 *  the longest. Returns runs in reading order, in bbox-local coordinates. */
function projectionRuns(ink: Float32Array, w: number, bb: Bbox, axis: ReadAxis): Run[] {
  const bw = bb.x1 - bb.x0;
  const bh = bb.y1 - bb.y0;
  const len = axis === "h" ? bw : bh;
  if (len <= 0) return [];
  const prof = new Float32Array(len);
  if (axis === "h") {
    for (let y = bb.y0; y < bb.y1; y++) {
      const row = y * w;
      for (let x = bb.x0; x < bb.x1; x++) prof[x - bb.x0] += ink[row + x];
    }
  } else {
    for (let y = bb.y0; y < bb.y1; y++) {
      const row = y * w;
      for (let x = bb.x0; x < bb.x1; x++) prof[y - bb.y0] += ink[row + x];
    }
  }
  const perp = axis === "h" ? bh : bw;
  const smoothed = gaussian1d(prof, Math.max(1, len * 0.01));
  let peak = 0;
  for (let i = 0; i < len; i++) if (smoothed[i] > peak) peak = smoothed[i];
  const thr = GAP_FRAC * peak;
  const runs: Run[] = [];
  let start: number | null = null;
  for (let i = 0; i < len; i++) {
    const on = smoothed[i] >= thr;
    if (on && start === null) start = i;
    else if (!on && start !== null) {
      runs.push({ a: start, b: i });
      start = null;
    }
  }
  if (start !== null) runs.push({ a: start, b: len });
  if (runs.length === 0) return [];
  let longest = 0;
  for (const r of runs) longest = Math.max(longest, r.b - r.a);
  const kept = runs.filter((r) => r.b - r.a >= MIN_RUN_FRAC * longest);
  // The threshold above can't split tightly-set glyphs (no valley dips below
  // GAP_FRAC), so a dense line collapses into one giant run — the reason
  // detection broke past ~5 characters. Refine by the monospace pitch.
  const snap = gaussian1d(prof, Math.max(1, perp * SEG_SNAP_FRAC));
  return refineByPitch(kept, snap, perp);
}

/** Split runs too wide to be a single glyph into glyph-pitch sub-cells. Japanese
 *  print is ~monospaced (square em), so a run spanning ~N glyph widths is N
 *  merged glyphs; cut it into round(width/perp) cells, snapping each cut to the
 *  deepest valley near the expected pitch position (on a lightly-smoothed
 *  profile). Single-glyph runs (width ≈ perp) are returned untouched, so lines
 *  that the projection already split correctly are unaffected. */
function refineByPitch(runs: Run[], snap: Float32Array, perp: number): Run[] {
  if (perp <= 0) return runs;
  const out: Run[] = [];
  for (const run of runs) {
    const rw = run.b - run.a;
    const n = Math.max(1, Math.round(rw / perp));
    if (n <= 1) {
      out.push(run);
      continue;
    }
    let prev = run.a;
    for (let k = 1; k < n; k++) {
      const target = run.a + (rw * k) / n;
      const win = Math.max(2, Math.round((rw / n) * 0.3));
      const lo = Math.max(prev + 1, Math.round(target) - win);
      const hi = Math.min(run.b - 1, Math.round(target) + win);
      let cut = Math.round(target);
      if (hi > lo) {
        let bestVal = Infinity;
        for (let p = lo; p < hi; p++) {
          if (snap[p] < bestVal) {
            bestVal = snap[p];
            cut = p;
          }
        }
      }
      out.push({ a: prev, b: cut });
      prev = cut;
    }
    out.push({ a: prev, b: run.b });
  }
  return out;
}

/** Geometric leak filter (FINDINGS §5). Projection produces extra cells for
 *  partial glyphs cut by the guide-box edge; the recognizer can't reject them
 *  (no garbage class), so drop a *first or last* cell whose extent is well below
 *  the median. Conservative — never touches interior cells and always keeps at
 *  least one. */
function dropLeakRuns(runs: Run[]): Run[] {
  if (runs.length < 3) {
    // With 1–2 cells there's no reliable median; only a clearly tiny edge cell
    // beside a much larger one is a confident leak.
    if (runs.length === 2) {
      const e0 = runs[0].b - runs[0].a;
      const e1 = runs[1].b - runs[1].a;
      if (e0 < LEAK_EDGE_FRAC * e1) return [runs[1]];
      if (e1 < LEAK_EDGE_FRAC * e0) return [runs[0]];
    }
    return runs;
  }
  const extents = runs.map((r) => r.b - r.a).sort((p, q) => p - q);
  const median = extents[extents.length >> 1];
  let lo = 0;
  let hi = runs.length;
  if (runs[lo].b - runs[lo].a < LEAK_EDGE_FRAC * median) lo++;
  if (hi - 1 > lo && runs[hi - 1].b - runs[hi - 1].a < LEAK_EDGE_FRAC * median) hi--;
  return runs.slice(lo, hi);
}

// --------------------------------------------------------------------------- //
// 6. normalize a cell → 96×96 model input
// --------------------------------------------------------------------------- //

/** Crop the cell to its own ink bbox, fit into the 96² square with MARGIN_FRAC,
 *  BILINEAR-resample (via canvas), and paste centered onto a zero canvas.
 *  Mirrors `probe.py::normalize_glyph` / preprocess.ts. Returns null when the
 *  cell has no ink. */
function normalizeCell(
  ink: Float32Array,
  w: number,
  region: Bbox,
): Float32Array | null {
  // tight ink bbox within the cell region
  let x0 = region.x1;
  let x1 = region.x0 - 1;
  let y0 = region.y1;
  let y1 = region.y0 - 1;
  for (let y = region.y0; y < region.y1; y++) {
    const row = y * w;
    for (let x = region.x0; x < region.x1; x++) {
      if (ink[row + x] > INK_THRESH) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // Pack the cropped ink into an opaque grayscale ImageData (ink → bright on a
  // black canvas), so a single drawImage performs the BILINEAR downsample.
  const crop = new ImageData(cw, ch);
  const cd = crop.data;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const v = Math.min(255, Math.max(0, Math.round(ink[(y0 + y) * w + (x0 + x)] * 255)));
      const di = (y * cw + x) * 4;
      cd[di] = v;
      cd[di + 1] = v;
      cd[di + 2] = v;
      cd[di + 3] = 255;
    }
  }
  const srcCanvas = makeCanvas(cw, ch);
  const sctx = ctx2d(srcCanvas);
  if (!sctx) return null;
  sctx.putImageData(crop, 0, 0);

  const target = INPUT_SIZE * (1 - 2 * MARGIN_FRAC);
  const scale = Math.min(target / cw, target / ch);
  const nw = Math.max(1, Math.round(cw * scale));
  const nh = Math.max(1, Math.round(ch * scale));
  const dst = makeCanvas(INPUT_SIZE, INPUT_SIZE);
  const dctx = ctx2d(dst, true);
  if (!dctx) return null;
  dctx.fillStyle = "#000"; // zero background
  dctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  const ox = Math.floor((INPUT_SIZE - nw) / 2);
  const oy = Math.floor((INPUT_SIZE - nh) / 2);
  dctx.drawImage(srcCanvas as CanvasImageSource, 0, 0, cw, ch, ox, oy, nw, nh);

  const out = new Float32Array(INPUT_SIZE * INPUT_SIZE);
  const px = dctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  for (let j = 0, i = 0; j < out.length; j++, i += 4) {
    out[j] = px[i] / 255; // R channel == ink (already ink=1/bg=0)
  }
  return out;
}

// --------------------------------------------------------------------------- //
// public entry point
// --------------------------------------------------------------------------- //

export type ImageToCellsOptions = {
  /** Foreground extraction strategy. Default `color` (safe for arbitrary
   *  camera scenes; degrades to bgdist for monochrome text). */
  foreground?: ForegroundStrategy;
};

/**
 * Full camera pipeline: a cropped guide-box ImageData + the reading axis →
 * one 96×96 recognizer input per detected character, in reading order.
 *
 * Returns an empty array when no ink survives extraction (e.g. a blank frame).
 */
export function imageToCells(
  image: ImageData,
  axis: ReadAxis,
  options: ImageToCellsOptions = {},
): Float32Array[] {
  const strategy = options.foreground ?? "color";
  const scaled = maybeDownscale(image);
  const w = scaled.width;
  const h = scaled.height;

  let ink = FOREGROUND[strategy](scaled);
  ink = cleanComponents(ink, w, h);
  ink = blur05(ink, w, h);

  const bb = inkBbox(ink, w, h);
  if (!bb) return [];

  const runs = dropLeakRuns(projectionRuns(ink, w, bb, axis));
  const cells: Float32Array[] = [];
  for (const run of runs) {
    // Each cell keeps the full perpendicular extent of the ink bbox; the run
    // bounds the reading axis. normalizeCell re-crops to the cell's own ink.
    const region: Bbox =
      axis === "h"
        ? { x0: bb.x0 + run.a, x1: bb.x0 + run.b, y0: bb.y0, y1: bb.y1 }
        : { x0: bb.x0, x1: bb.x1, y0: bb.y0 + run.a, y1: bb.y0 + run.b };
    const cell = normalizeCell(ink, w, region);
    if (cell) cells.push(cell);
  }
  return cells;
}
