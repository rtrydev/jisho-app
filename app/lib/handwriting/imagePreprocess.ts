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
//   3. connected-component cleanup (drop frame-spanning rules + micro-specks)
//   4. mild Gaussian (σ≈0.5) to restore the anti-aliased edge the model expects
//   5. line segmentation: cross-axis projection → one band per text line
//      (rows for horizontal text; columns for vertical, read right-to-left),
//      with noise-band filtering, sliced-line repair (the square-em test that
//      keeps 三/言/川 captures whole), furigana dropping, and clipped-edge-
//      line filtering
//   6. glyph-scale speck pruning — the line height (em) is known now, so
//      "speck" can finally mean "small relative to a character"
//   7. per-line projection-profile segmentation along the reading axis → cells
//   8. geometric leak filter (drop sub-median edge cells within each line)
//   9. normalize each cell to a 96×96 model input, excluding junk components
//      that rode into the cell (they would shift/shrink the glyph in the fit)
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
const LEAK_EDGE_FRAC = 0.5; // edge cell < 0.5× median extent → treat as a leak
// Pass-1 speck floor (cleanComponents, before any glyph scale is known). This
// only drops sensor-grade micro-noise: an image-relative threshold (the old
// 0.0008·w·h) assumed one full-height line and over-prunes the moment the crop
// holds several smaller lines — on a dense crop it is bigger than a dakuten or
// a thin stroke of a small glyph. The real, glyph-relative speck cut happens in
// segmentGrid once line detection has produced an em estimate.
const TINY_SPECK_FLOOR_FRAC = 0.00003;
const TINY_SPECK_MIN_AREA = 4; // px², absolute floor for tiny crops
// Glyph-relative speck pruning (after line detection): components smaller than
// this fraction of em² are noise. Sized to stay well below a dakuten mark
// (~0.003–0.008·em²) while catching dust/JPEG junk (≲0.0005·em²).
const SPECK_EM_FRAC = 0.0015;
// Line-band detection along the cross axis. Valleys between text lines are
// true whitespace (~0 mass), so the cut threshold is much lower than the
// per-character GAP_FRAC — a sparse line (one char) must survive next to a
// dense one (many chars), and their row-mass can differ by >10×.
const LINE_GAP_FRAC = 0.02;
// A band whose total ink mass is far below the densest band's is a noise band
// (a cluster of surviving specks, a smudge), not a sparse text line: even a
// single-character line keeps several % of a 15-character line's mass.
const LINE_MIN_MASS_FRAC = 0.015;
// A first/last band that *touches the crop edge* and is well under the median
// band extent is a neighbouring line the guide box sliced through — the line-
// level analogue of the per-cell leak filter. The edge-touch requirement
// spares legitimately thin interior bands (a line of 一二三 is a thin band that
// sits away from the edges). Touch tolerance covers the σ≈0.5 blur spread.
const EDGE_TOUCH_PX = 2;
// Sliced-line repair (the square-em test). The cross-axis valley cut can't
// tell a gap BETWEEN lines from a gap INSIDE every character of one line:
// 三 言 こ — or any short capture of horizontally-divisible glyphs — put
// full-width whitespace through the middle of the line, so it shreds into
// stripe "lines" and every stripe misreads (each bar of 三 becomes 一); a lone
// 川 does the same on the vertical axis. Gap size can't discriminate (the
// gaps inside 三 are as wide as real leading), but the square em grid of
// Japanese print can: cells of a real line are ~square, cells of a slice are
// far wider than the band is tall. Bands whose cells are wide are re-merged
// with a neighbour while that moves the aspect toward square; a merge that
// crosses into a genuinely separate line makes the cells markedly TALLER
// than wide and is rejected.
const WIDE_CELL_RATIO = 1.6; // try to repair a band above this width/height
const MIN_MERGED_RATIO = 0.75; // merged cells below this = two real lines
// Furigana filter. A band well under the surrounding line height, hugging a
// full-size line, whose own cells are square AT ITS OWN SCALE is furigana.
// Pre-multi-line such glyphs were merely absorbed into the main line's cells;
// detected as their own line they'd be read as standalone (tiny, usually
// misrecognized) characters interleaved into the output — for vertical text
// even BEFORE their parent column. The squareness condition spares thin
// bar-kanji lines (一二三 — wide cells, not square), and the adjacency
// condition spares genuinely small standalone lines (captions sit at normal
// leading, furigana hugs its parent).
const FURIGANA_MAX_EXTENT_FRAC = 0.55; // vs the median band extent…
const FURIGANA_MAX_GAP_FRAC = 0.25; // …with a full-size band this close
const FURIGANA_SQUARE_MIN = 0.6;
const FURIGANA_SQUARE_MAX = 1.8;
// Per-cell junk exclusion (normalizeCell). A component well below the cell's
// dominant component (< 5% of its area) that also sits clear of the glyph core
// is junk that rode into the cell; legitimate detached parts (dakuten, the
// dots of 心, い's second stroke) are either not that small or hug the core.
const CELL_MINOR_AREA_FRAC = 0.05;
const CELL_CORE_GAP_FRAC = 0.12; // ..."clear of" = farther than this × em
// Hard ceiling on characters read per capture, in reading order. Real crops
// rarely exceed ~4 lines × 10 characters; far past that it's a pathological
// segmentation of a noisy frame, and every region costs a normalization plus
// a forward pass. The ceiling bounds the worst-case work (the load profile
// that got the tab killed on phones) instead of letting a bad frame schedule
// hundreds of runs.
const MAX_READ_CELLS = 40;
// Light smoothing (as a fraction of glyph size) for the valley-snapping profile
// used by the pitch refinement — see refineByPitch / projectionRuns.
const SEG_SNAP_FRAC = 0.05;
const MAX_CROP_DIM = 1080; // downscale ceiling so the pixel ops stay cheap

// Glyph-likeness gate (text-presence detection). The recognizer is kanji-only
// with no garbage class and a low-magnitude softmax, so it confidently mis-reads
// arbitrary photo regions; nothing downstream asks "is this even a character?".
// These structural cutoffs reject the two dominant non-text inputs BEFORE
// recognition, from the cell's own geometry rather than recognizer confidence:
//   • near-empty cells (a speck of leftover noise), and
//   • solid filled regions (a dark object / shadow / out-of-focus blob) — ink
//     that fills most of a 2-D bounding box, unlike the sparse strokes of a
//     glyph.
// The 2-D guard is what spares legitimately solid-but-thin line kanji (一 二 三):
// their ink bbox is a thin band, so the "fills its box" test only fires when the
// box spans BOTH axes. Deliberately lenient — a missed blob is cheaper than
// rejecting a real character.
const GLYPH_MIN_INK_FRAC = 0.01; // < 1% of the cell is ink → nothing to read
const GLYPH_MAX_FILL = 0.78; // ink fills > 78% of its bbox → a solid region
const GLYPH_BLOB_MIN_DIM = 0.4; // ...only count that as a blob when the bbox spans ≥ 40% of BOTH axes

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
 *  colour bands / page edges) or that are micro-specks. Mirrors
 *  `probe.py::clean_components`, except the speck floor is now scale-
 *  independent — glyph-relative speck pruning happens later in segmentGrid,
 *  once line detection has established the em (see TINY_SPECK_FLOOR_FRAC). */
function cleanComponents(ink: Float32Array, w: number, h: number): Float32Array {
  const mask = new Uint8Array(ink.length);
  for (let j = 0; j < ink.length; j++) mask[j] = ink[j] > INK_THRESH ? 1 : 0;
  const { labels, comps } = labelComponents(mask, w, h);
  if (comps.length === 0) return ink;
  const out = ink.slice();
  const speck = Math.max(TINY_SPECK_MIN_AREA, TINY_SPECK_FLOOR_FRAC * w * h);
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

export type Bbox = { x0: number; x1: number; y0: number; y1: number };

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

/** Tight ink bbox restricted to `region`. Null when the region has no ink. */
function inkBboxIn(ink: Float32Array, w: number, region: Bbox): Bbox | null {
  let x0 = region.x1;
  let x1 = -1;
  let y0 = region.y1;
  let y1 = -1;
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
 *  the longest. Returns runs in reading order, in bbox-local coordinates.
 *  `perpOverride` supplies the character-pitch reference (the em) when the
 *  caller knows it better than this bbox does — a line whose own ink band is
 *  thin (一二三) must still be cut at the *line-height* pitch, not its band
 *  thickness, or the pitch refinement shreds every wide glyph. */
function projectionRuns(
  ink: Float32Array,
  w: number,
  bb: Bbox,
  axis: ReadAxis,
  perpOverride?: number,
): Run[] {
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
  const perp = perpOverride ?? (axis === "h" ? bh : bw);
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
// 5b. line segmentation (multi-line support) + glyph-scale speck pruning
// --------------------------------------------------------------------------- //

/** Split the ink bbox into text-line bands along the CROSS axis: horizontal
 *  text projects onto y (one band per row of text), vertical text onto x (one
 *  band per column). Valleys between lines are true whitespace, so the cut
 *  threshold is LINE_GAP_FRAC (not the per-character GAP_FRAC — see the
 *  constants). Bands come back in ascending coordinate order, bbox-local. */
function lineBands(
  ink: Float32Array,
  w: number,
  bb: Bbox,
  axis: ReadAxis,
): Run[] {
  const len = axis === "h" ? bb.y1 - bb.y0 : bb.x1 - bb.x0;
  if (len <= 0) return [];
  const prof = new Float32Array(len);
  for (let y = bb.y0; y < bb.y1; y++) {
    const row = y * w;
    for (let x = bb.x0; x < bb.x1; x++) {
      prof[axis === "h" ? y - bb.y0 : x - bb.x0] += ink[row + x];
    }
  }
  const smoothed = gaussian1d(prof, Math.max(1, len * 0.01));
  let peak = 0;
  for (let i = 0; i < len; i++) if (smoothed[i] > peak) peak = smoothed[i];
  const thr = LINE_GAP_FRAC * peak;
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
  if (runs.length <= 1) return runs;
  // Noise bands: a band whose total mass is a sliver of the densest band's is
  // surviving junk, not a sparse line. (Extent can't be the test — a line of
  // thin bar-kanji is a legitimately thin band.)
  const mass = runs.map((r) => {
    let m = 0;
    for (let i = r.a; i < r.b; i++) m += prof[i];
    return m;
  });
  const maxMass = Math.max(...mass);
  return runs.filter((_, i) => mass[i] >= LINE_MIN_MASS_FRAC * maxMass);
}

/** The image region a (bbox-local) band covers: full bbox along the reading
 *  axis, the band's span across it. */
function bandRegion(bb: Bbox, band: Run, axis: ReadAxis): Bbox {
  return axis === "h"
    ? { x0: bb.x0, x1: bb.x1, y0: bb.y0 + band.a, y1: bb.y0 + band.b }
    : { x0: bb.x0 + band.a, x1: bb.x0 + band.b, y0: bb.y0, y1: bb.y1 };
}

/** Median raw run extent along the reading axis within a band — the "how wide
 *  are this band's cells" statistic the square-em passes compare against the
 *  band's own extent. Raw valley runs only: no pitch refinement (that needs
 *  the em these passes are still establishing) and no min-run filter. */
function bandMedianRun(
  ink: Float32Array,
  w: number,
  bb: Bbox,
  axis: ReadAxis,
  band: Run,
): number {
  const tight = inkBboxIn(ink, w, bandRegion(bb, band, axis));
  if (!tight) return 0;
  const len = axis === "h" ? tight.x1 - tight.x0 : tight.y1 - tight.y0;
  if (len <= 0) return 0;
  const prof = new Float32Array(len);
  for (let y = tight.y0; y < tight.y1; y++) {
    const row = y * w;
    for (let x = tight.x0; x < tight.x1; x++) {
      prof[axis === "h" ? x - tight.x0 : y - tight.y0] += ink[row + x];
    }
  }
  const smoothed = gaussian1d(prof, Math.max(1, len * 0.01));
  let peak = 0;
  for (let i = 0; i < len; i++) if (smoothed[i] > peak) peak = smoothed[i];
  const thr = GAP_FRAC * peak;
  const extents: number[] = [];
  let start: number | null = null;
  for (let i = 0; i < len; i++) {
    const on = smoothed[i] >= thr;
    if (on && start === null) start = i;
    else if (!on && start !== null) {
      extents.push(i - start);
      start = null;
    }
  }
  if (start !== null) extents.push(len - start);
  if (extents.length === 0) return 0;
  extents.sort((p, q) => p - q);
  return extents[extents.length >> 1];
}

/** Sliced-line repair (see the WIDE_CELL_RATIO note): greedily re-merge a
 *  band whose cells are much wider than the band is tall with an adjacent
 *  band, as long as the merge moves the cell aspect toward square and doesn't
 *  overshoot into clearly-taller-than-wide (two real lines). Bands stay in
 *  ascending order. */
function mergeSlicedBands(
  ink: Float32Array,
  w: number,
  bb: Bbox,
  axis: ReadAxis,
  bands: Run[],
): Run[] {
  if (bands.length < 2) return bands;
  const cellRatio = (band: Run): number => {
    const extent = band.b - band.a;
    if (extent <= 0) return 1;
    const med = bandMedianRun(ink, w, bb, axis, band);
    return med > 0 ? med / extent : 1;
  };
  const out = bands.slice();
  for (let merged = true; merged && out.length > 1; ) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      const ratio = cellRatio(out[i]);
      if (ratio <= WIDE_CELL_RATIO) continue;
      // Try the neighbour across the smaller gap first — slices of one glyph
      // row sit closer to each other than to the next real line.
      const gapPrev = i > 0 ? out[i].a - out[i - 1].b : Infinity;
      const gapNext = i < out.length - 1 ? out[i + 1].a - out[i].b : Infinity;
      const order = gapPrev <= gapNext ? [i - 1, i + 1] : [i + 1, i - 1];
      for (const j of order) {
        if (j < 0 || j >= out.length) continue;
        const candidate: Run = {
          a: Math.min(out[i].a, out[j].a),
          b: Math.max(out[i].b, out[j].b),
        };
        const mergedRatio = cellRatio(candidate);
        if (mergedRatio < MIN_MERGED_RATIO) continue; // crossed into another line
        if (Math.abs(Math.log(mergedRatio)) >= Math.abs(Math.log(ratio))) continue;
        out.splice(Math.min(i, j), 2, candidate);
        merged = true;
        break;
      }
    }
  }
  return out;
}

/** Drop furigana bands (see the FURIGANA_* note): well under the median line
 *  height, hugging a full-size band, square cells at their own scale. */
function dropFuriganaBands(
  ink: Float32Array,
  w: number,
  bb: Bbox,
  axis: ReadAxis,
  bands: Run[],
): Run[] {
  if (bands.length < 2) return bands;
  const extents = bands.map((r) => r.b - r.a);
  const sorted = extents.slice().sort((p, q) => p - q);
  const median = sorted[sorted.length >> 1];
  return bands.filter((band, i) => {
    if (extents[i] >= FURIGANA_MAX_EXTENT_FRAC * median) return true;
    const gapTol = FURIGANA_MAX_GAP_FRAC * median;
    const hugsPrev =
      i > 0 && band.a - bands[i - 1].b <= gapTol && extents[i - 1] >= 0.8 * median;
    const hugsNext =
      i < bands.length - 1 &&
      bands[i + 1].a - band.b <= gapTol &&
      extents[i + 1] >= 0.8 * median;
    if (!hugsPrev && !hugsNext) return true;
    const med = bandMedianRun(ink, w, bb, axis, band);
    const ratio = med > 0 && extents[i] > 0 ? med / extents[i] : 1;
    return ratio < FURIGANA_SQUARE_MIN || ratio > FURIGANA_SQUARE_MAX;
  });
}

/** Line-level leak filter: drop a first/last band that touches the crop edge
 *  and is well under the median band extent — a neighbouring line the guide
 *  box sliced through. Interior bands and non-edge-touching bands are never
 *  dropped, so a framed-but-thin line (一二三) survives. */
function dropClippedEdgeBands(bands: Run[], cross0: number, crossEnd: number): Run[] {
  if (bands.length < 2) return bands;
  const extent = (r: Run) => r.b - r.a;
  const touches = (r: Run) =>
    cross0 + r.a <= EDGE_TOUCH_PX || cross0 + r.b >= crossEnd - EDGE_TOUCH_PX;
  if (bands.length === 2) {
    const [r0, r1] = bands;
    if (touches(r0) && extent(r0) < LEAK_EDGE_FRAC * extent(r1)) return [r1];
    if (touches(r1) && extent(r1) < LEAK_EDGE_FRAC * extent(r0)) return [r0];
    return bands;
  }
  const extents = bands.map(extent).sort((p, q) => p - q);
  const median = extents[extents.length >> 1];
  let lo = 0;
  let hi = bands.length;
  if (touches(bands[lo]) && extent(bands[lo]) < LEAK_EDGE_FRAC * median) lo++;
  if (hi - 1 > lo && touches(bands[hi - 1]) && extent(bands[hi - 1]) < LEAK_EDGE_FRAC * median)
    hi--;
  return bands.slice(lo, hi);
}

/** Zero every component smaller than SPECK_EM_FRAC × em² — the glyph-relative
 *  speck cut that pass-1 cleanComponents can't make (no scale known there).
 *  Returns `ink` untouched when nothing qualifies. */
function pruneSpecksByEm(
  ink: Float32Array,
  w: number,
  h: number,
  em: number,
): Float32Array {
  const minArea = SPECK_EM_FRAC * em * em;
  if (minArea <= 1) return ink;
  const mask = new Uint8Array(ink.length);
  for (let j = 0; j < ink.length; j++) mask[j] = ink[j] > INK_THRESH ? 1 : 0;
  const { labels, comps } = labelComponents(mask, w, h);
  const drop = new Uint8Array(comps.length + 1); // 1-indexed labels
  let any = false;
  for (let c = 0; c < comps.length; c++) {
    if (comps[c].area < minArea) {
      drop[c + 1] = 1;
      any = true;
    }
  }
  if (!any) return ink;
  const out = ink.slice();
  for (let j = 0; j < out.length; j++) {
    if (drop[labels[j]]) out[j] = 0;
  }
  return out;
}

export type SegmentedGrid = {
  /** One region per detected character, in reading order: horizontal text
   *  reads lines top-to-bottom and characters left-to-right; vertical text
   *  reads columns right-to-left and characters top-to-bottom. */
  regions: Bbox[];
  /** Line-height estimate (median line-band extent) in crop px. */
  em: number;
  /** The ink map after glyph-relative speck pruning — cells must be cut from
   *  this, not the input, so pruned junk doesn't reappear in a cell. */
  ink: Float32Array;
};

/**
 * Pure multi-line segmentation core (exported for tests): cleaned ink map →
 * per-character regions in reading order. Lines first (cross-axis bands),
 * then characters within each line (reading-axis projection + pitch
 * refinement + leak filter). A single-line crop yields one band whose em is
 * its own extent, which reproduces the previous single-line behaviour.
 */
export function segmentGrid(
  inkIn: Float32Array,
  w: number,
  h: number,
  axis: ReadAxis,
): SegmentedGrid {
  const bb = inkBbox(inkIn, w, h);
  if (!bb) return { regions: [], em: 0, ink: inkIn };
  // Band passes, in dependency order: detect (valley cut + noise-mass
  // filter), repair sliced lines (so 三/言/川 captures are whole again before
  // anything compares extents), drop furigana, then drop crop-clipped edge
  // lines (last, so a sliver merged back into its line is no longer there to
  // be dropped, and the median reflects repaired lines).
  let bands = lineBands(inkIn, w, bb, axis);
  bands = mergeSlicedBands(inkIn, w, bb, axis, bands);
  bands = dropFuriganaBands(inkIn, w, bb, axis, bands);
  bands = dropClippedEdgeBands(
    bands,
    axis === "h" ? bb.y0 : bb.x0,
    axis === "h" ? h : w,
  );
  // Tategaki columns read right-to-left; rows already come top-to-bottom.
  if (axis === "v") bands = bands.slice().reverse();
  const extents = bands.map((r) => r.b - r.a).sort((p, q) => p - q);
  const em = extents.length
    ? extents[extents.length >> 1]
    : axis === "h"
      ? bb.y1 - bb.y0
      : bb.x1 - bb.x0;
  const ink = pruneSpecksByEm(inkIn, w, h, em);

  const regions: Bbox[] = [];
  for (const band of bands) {
    // Tight per-line bbox (post-pruning): keeps each cell's perpendicular
    // extent to the line's own ink, so neighbouring lines can't bleed in.
    const lineBb = inkBboxIn(ink, w, bandRegion(bb, band, axis));
    if (!lineBb) continue;
    const runs = dropLeakRuns(projectionRuns(ink, w, lineBb, axis, em));
    for (const run of runs) {
      regions.push(
        axis === "h"
          ? { x0: lineBb.x0 + run.a, x1: lineBb.x0 + run.b, y0: lineBb.y0, y1: lineBb.y1 }
          : { x0: lineBb.x0, x1: lineBb.x1, y0: lineBb.y0 + run.a, y1: lineBb.y0 + run.b },
      );
    }
  }
  return { regions, em, ink };
}

// --------------------------------------------------------------------------- //
// 6. normalize a cell → 96×96 model input
// --------------------------------------------------------------------------- //

/** Max axis-gap between two (inclusive-coordinate) component bboxes; 0 when
 *  they touch or overlap. */
function bboxGap(a: Component, b: Component): number {
  const gx = Math.max(0, Math.max(b.x0 - a.x1, a.x0 - b.x1));
  const gy = Math.max(0, Math.max(b.y0 - a.y1, a.y0 - b.y1));
  return Math.max(gx, gy);
}

/** Crop the cell to its own ink bbox, fit into the 96² square with MARGIN_FRAC,
 *  BILINEAR-resample (via canvas), and paste centered onto a zero canvas.
 *  Mirrors `probe.py::normalize_glyph` / preprocess.ts. Returns null when the
 *  cell has no ink.
 *
 *  Junk exclusion: noise that rode into the cell (a blob the speck pruning
 *  couldn't catch, a fragment of a neighbouring character across the cut)
 *  would inflate the crop bbox and shrink/offset the glyph inside the 96²
 *  square — the dominant way residual noise breaks recognition. So the cell's
 *  own components are labelled, and a component that is BOTH a sliver of the
 *  dominant one (< CELL_MINOR_AREA_FRAC of its area) AND clear of the glyph
 *  core (> CELL_CORE_GAP_FRAC × em away) is left out of the crop bbox and
 *  zeroed in the copied pixels. Legitimate detached parts (dakuten, the dots
 *  of 心, い's strokes) are bigger or hug the core, so they stay. */
function normalizeCell(
  ink: Float32Array,
  w: number,
  region: Bbox,
  em = 0,
): Float32Array | null {
  const rw = region.x1 - region.x0;
  const rh = region.y1 - region.y0;
  if (rw <= 0 || rh <= 0) return null;
  // Label the cell's components (region-local mask).
  const mask = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const row = (region.y0 + y) * w + region.x0;
    for (let x = 0; x < rw; x++) mask[y * rw + x] = ink[row + x] > INK_THRESH ? 1 : 0;
  }
  const { labels, comps } = labelComponents(mask, rw, rh);
  if (comps.length === 0) return null;
  let maxArea = 0;
  for (const c of comps) maxArea = Math.max(maxArea, c.area);
  const minorFloor = CELL_MINOR_AREA_FRAC * maxArea;
  // Core = union bbox of the non-minor components.
  let core: Component | null = null;
  for (const c of comps) {
    if (c.area < minorFloor) continue;
    core = core
      ? {
          area: core.area + c.area,
          x0: Math.min(core.x0, c.x0),
          x1: Math.max(core.x1, c.x1),
          y0: Math.min(core.y0, c.y0),
          y1: Math.max(core.y1, c.y1),
        }
      : { ...c };
  }
  const gapTol = Math.max(2, CELL_CORE_GAP_FRAC * em);
  const include = comps.map(
    (c) =>
      c.area >= minorFloor || em <= 0 || core === null || bboxGap(c, core) <= gapTol,
  );
  // Crop bbox = union of the included components (region-local, inclusive).
  let x0 = rw;
  let x1 = -1;
  let y0 = rh;
  let y1 = -1;
  for (let c = 0; c < comps.length; c++) {
    if (!include[c]) continue;
    if (comps[c].x0 < x0) x0 = comps[c].x0;
    if (comps[c].x1 > x1) x1 = comps[c].x1;
    if (comps[c].y0 < y0) y0 = comps[c].y0;
    if (comps[c].y1 > y1) y1 = comps[c].y1;
  }
  if (x1 < x0 || y1 < y0) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // Pack the cropped ink into an opaque grayscale ImageData (ink → bright on a
  // black canvas), so a single drawImage performs the BILINEAR downsample.
  // Pixels of excluded components are zeroed; background (label 0, incl. the
  // soft anti-aliased halo below INK_THRESH) is copied as-is.
  const crop = new ImageData(cw, ch);
  const cd = crop.data;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const label = labels[(y0 + y) * rw + (x0 + x)];
      const raw =
        label > 0 && !include[label - 1]
          ? 0
          : ink[(region.y0 + y0 + y) * w + (region.x0 + x0 + x)];
      const v = Math.min(255, Math.max(0, Math.round(raw * 255)));
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
// 7. glyph-likeness gate (text presence)
// --------------------------------------------------------------------------- //

/**
 * Structural test for "this normalized cell holds a character, not a stray bit
 * of a non-text photo". Pure (no canvas) — operates on a `size`×`size` ink map
 * (ink=1/bg=0). Rejects near-empty cells and solid 2-D blobs; see the constant
 * block above for the rationale and the line-kanji exception.
 */
export function looksLikeGlyph(cell: Float32Array, size = INPUT_SIZE): boolean {
  let ink = 0;
  let x0 = size;
  let x1 = -1;
  let y0 = size;
  let y1 = -1;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      if (cell[row + x] > INK_THRESH) {
        ink++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return false; // no ink at all
  if (ink < GLYPH_MIN_INK_FRAC * size * size) return false; // basically empty
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const fill = ink / (bw * bh);
  const is2D = Math.min(bw, bh) >= GLYPH_BLOB_MIN_DIM * size;
  if (is2D && fill > GLYPH_MAX_FILL) return false; // solid filled region, not strokes
  return true;
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
 * Multi-line crops are supported: horizontal text reads lines top-to-bottom
 * and characters left-to-right; vertical text reads columns right-to-left and
 * characters top-to-bottom (see segmentGrid).
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

  const grid = segmentGrid(ink, w, h, axis);
  // Truncation keeps reading order, so when a noisy frame over-segments, the
  // first lines still come through rather than nothing at all.
  const regions =
    grid.regions.length > MAX_READ_CELLS
      ? grid.regions.slice(0, MAX_READ_CELLS)
      : grid.regions;
  const cells: Float32Array[] = [];
  for (const region of regions) {
    const cell = normalizeCell(grid.ink, w, region, grid.em);
    // Keep only cells that structurally read as a character — drops blank/blob
    // cells from a non-text photo so the recognizer never fabricates a kanji
    // from one (it has no garbage class to reject it itself).
    if (cell && looksLikeGlyph(cell)) cells.push(cell);
  }
  return cells;
}
