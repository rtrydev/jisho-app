// Boundary prediction for Draw mode.
//
// Renders the whole drawing into a height-normalized grayscale strip (the input
// the segmenter ONNX was trained on — see tools/handwriting_ocr/segment_*.py),
// runs the model, and decodes the 1-D boundary heatmap into character-boundary
// x-positions in *drawing* coordinates. `splitStrokesByBoundaries` (segment.ts)
// turns those into per-character stroke groups.
//
// Strip layout mirrors the synthesis pipeline: content scaled by height to a
// fixed fraction of the strip (preserving aspect), left-aligned after a small
// margin, vertically centered, background-padded to the full width. Must stay
// in sync with SegmentPolicy in tools/handwriting_ocr/config.py.

import type { InferenceSession } from "onnxruntime-web";
import type { Stroke } from "./types";

const STRIP_H = 64;
const STRIP_W = 384;
const WIDTH_STRIDE = 4; // → output heatmap length = STRIP_W / WIDTH_STRIDE = 96
const MARGIN = 4; // left/right padding in strip px
const TARGET_H_FRAC = 0.8; // drawing height maps to this fraction of strip height
const STROKE_WIDTH = 2.6; // strip px (matches the synthesized glyph stroke weight at 64px)
const SUPERSAMPLE = 3;

// Boundary heatmap decoding — kept in sync with segment_train.py (PEAK_*,
// INK_WINDOW) and segment_synth.decode_boundaries.
const PEAK_THRESHOLD = 0.4;
const PEAK_MIN_SEP = 6; // output columns
const INK_WINDOW = 12; // require ink within this many columns on each side

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function strokesBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const s of strokes) {
    for (const p of s) {
      any = true;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

/** Per output-column ink flag (length STRIP_W / WIDTH_STRIDE): true where the
 *  strip has ink in that column band. Mirrors column_ink in segment_synth.py. */
function columnInk(data: Float32Array): boolean[] {
  const length = STRIP_W / WIDTH_STRIDE;
  const out = new Array<boolean>(length).fill(false);
  for (let row = 0; row < STRIP_H; row++) {
    const base = row * STRIP_W;
    for (let x = 0; x < STRIP_W; x++) {
      if (data[base + x] > 0.1) out[(x / WIDTH_STRIDE) | 0] = true;
    }
  }
  return out;
}

type StripRender = { data: Float32Array; scale: number; offX: number; minX: number };

/** Render strokes into the STRIP_H×STRIP_W model input (ink=1, bg=0), and
 *  return the transform needed to map strip-x back to drawing-x. */
function renderStrip(strokes: Stroke[]): StripRender | null {
  const b = strokesBounds(strokes);
  if (!b) return null;
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  // Scale by height to the target fraction, but never let content overflow the
  // strip width (mirrors the synthesis "shrink to fit").
  const scale = Math.min((TARGET_H_FRAC * STRIP_H) / h, (STRIP_W - 2 * MARGIN) / w);
  const contentH = h * scale;
  const offX = MARGIN;
  const offY = (STRIP_H - contentH) / 2;

  const RW = STRIP_W * SUPERSAMPLE;
  const RH = STRIP_H * SUPERSAMPLE;
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(RW, RH)
      : Object.assign(document.createElement("canvas"), { width: RW, height: RH });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, RW, RH);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = STROKE_WIDTH * SUPERSAMPLE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const mapX = (x: number) => ((x - b.minX) * scale + offX) * SUPERSAMPLE;
  const mapY = (y: number) => ((y - b.minY) * scale + offY) * SUPERSAMPLE;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(mapX(stroke[0].x), mapY(stroke[0].y));
    if (stroke.length === 1) {
      ctx.lineTo(mapX(stroke[0].x) + 0.01, mapY(stroke[0].y) + 0.01);
    } else {
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(mapX(stroke[i].x), mapY(stroke[i].y));
    }
    ctx.stroke();
  }

  // Downsample to the model resolution.
  const small: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(STRIP_W, STRIP_H)
      : Object.assign(document.createElement("canvas"), { width: STRIP_W, height: STRIP_H });
  const sctx = small.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!sctx) return null;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas as CanvasImageSource, 0, 0, STRIP_W, STRIP_H);

  const img = sctx.getImageData(0, 0, STRIP_W, STRIP_H);
  const px = img.data;
  const data = new Float32Array(STRIP_W * STRIP_H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
    data[j] = 1 - lum / 255; // ink = 1
  }
  return { data, scale, offX, minX: b.minX };
}

/** Greedy 1-D peak picking — mirrors find_peaks in segment_synth.py. */
function findPeaks(prob: Float32Array, threshold: number, minSep: number): number[] {
  const above: number[] = [];
  for (let i = 0; i < prob.length; i++) if (prob[i] >= threshold) above.push(i);
  above.sort((a, b) => prob[b] - prob[a]);
  const kept: number[] = [];
  for (const i of above) {
    if (kept.every((k) => Math.abs(i - k) >= minSep)) kept.push(i);
  }
  kept.sort((a, b) => a - b);
  return kept;
}

/**
 * Predict character-boundary x-positions (in drawing coordinates) for a
 * drawing. Returns an empty array when there's nothing to split (no ink,
 * single character, or the model finds no boundary).
 */
export async function predictBoundaries(
  segmenter: InferenceSession,
  strokes: Stroke[],
): Promise<number[]> {
  const render = renderStrip(strokes);
  if (!render) return [];

  // Compute the ink profile BEFORE inference: under `wasm.proxy = true`,
  // ORT-web transfers (neuters) the input tensor's ArrayBuffer to its worker,
  // so `render.data` is detached after `run()` and would read back as all
  // zeros — silently rejecting every boundary in the ink filter below.
  const ink = columnInk(render.data);

  const ort = await import("onnxruntime-web/wasm");
  const tensor = new ort.Tensor("float32", render.data, [1, 1, STRIP_H, STRIP_W]);
  const inputName = segmenter.inputNames[0];
  const outputName = segmenter.outputNames[0];
  const out = await segmenter.run({ [inputName]: tensor });
  const logits = out[outputName].data as Float32Array;

  const prob = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) prob[i] = 1 / (1 + Math.exp(-logits[i]));

  // Keep only peaks flanked by ink on both sides — rejects trailing/leading
  // edge false positives (a real break separates two ink regions).
  const hasInk = (lo: number, hi: number) => {
    for (let j = Math.max(0, lo); j < Math.min(ink.length, hi); j++) if (ink[j]) return true;
    return false;
  };
  const cols = findPeaks(prob, PEAK_THRESHOLD, PEAK_MIN_SEP).filter(
    (c) => hasInk(c - INK_WINDOW, c) && hasInk(c + 1, c + 1 + INK_WINDOW),
  );

  // column → strip-x (column centre) → drawing-x
  return cols.map((c) => {
    const stripX = c * WIDTH_STRIDE + WIDTH_STRIDE / 2;
    return (stripX - render.offX) / render.scale + render.minX;
  });
}
