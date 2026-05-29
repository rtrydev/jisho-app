// Strokes → 96×96 grayscale Float32Array.
//
// Mirrors the training-time normalization: auto-fit the ink bbox into the
// model's input square with a small margin, render strokes with rounded
// joins, then read pixels as ink-on-zero (matching the dataset, where
// background = 0 and ink = 1).
//
// IMPORTANT: IMAGE_SIZE and STROKE_WIDTH must stay in sync with the Python
// training config (tools/handwriting_ocr/config.py): IMAGE_SIZE ==
// SynthesisPolicy.image_size, and STROKE_WIDTH tracks the VAL_POLICY stroke
// thickness midpoint — VAL_POLICY is the deployment proxy the model is
// selected on, so inference should render strokes at that weight.

import type { Stroke } from "./types";

const IMAGE_SIZE = 96;
// Render at 4× resolution then downsample. Browser canvas anti-aliasing is
// adequate at 96×96 but supersampling is a cheap fidelity bump.
const RENDER_SCALE = 4;
const RENDER_SIZE = IMAGE_SIZE * RENDER_SCALE;

/** Fraction of the canvas reserved as margin on each side of the fit bbox.
 *  Matches the training augmentation's mean (`0.10 + uniform(0, 0.04)`). */
const MARGIN_FRAC = 0.12;

/** Stroke width in *output* pixels (before render-scale). 4.5px → 18px on the
 *  supersampled canvas. Matches the VAL_POLICY stroke-thickness midpoint at
 *  96px (3.5–5.5 → 4.5) so train and inference render strokes at one weight. */
const STROKE_WIDTH = 4.5;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function strokeBounds(strokes: Stroke[]): Bounds | null {
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
  if (!any) return null;
  return { minX, minY, maxX, maxY };
}

/** Render strokes onto a square Float32Array(IMAGE_SIZE * IMAGE_SIZE).
 *  Background = 0, ink = 1. Returns null if the strokes are empty. */
export function strokesToInput(strokes: Stroke[]): Float32Array | null {
  const bounds = strokeBounds(strokes);
  if (!bounds) return null;

  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const target = RENDER_SIZE * (1 - 2 * MARGIN_FRAC);
  const scale = Math.min(target / w, target / h);
  const offsetX = (RENDER_SIZE - w * scale) / 2;
  const offsetY = (RENDER_SIZE - h * scale) / 2;

  // OffscreenCanvas is supported in all modern browsers; fall back to a
  // standard canvas for the edge case of older Safari that doesn't ship it.
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(RENDER_SIZE, RENDER_SIZE)
      : Object.assign(document.createElement("canvas"), {
          width: RENDER_SIZE,
          height: RENDER_SIZE,
        });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;

  // White background, black ink — invert when we read pixels.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = STROKE_WIDTH * RENDER_SCALE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    const first = stroke[0];
    ctx.moveTo((first.x - bounds.minX) * scale + offsetX, (first.y - bounds.minY) * scale + offsetY);
    if (stroke.length === 1) {
      // Single-point "stroke" → render a dot.
      ctx.lineTo((first.x - bounds.minX) * scale + offsetX + 0.01, (first.y - bounds.minY) * scale + offsetY + 0.01);
    } else {
      for (let i = 1; i < stroke.length; i++) {
        const p = stroke[i];
        ctx.lineTo((p.x - bounds.minX) * scale + offsetX, (p.y - bounds.minY) * scale + offsetY);
      }
    }
    ctx.stroke();
  }

  // Downsample to IMAGE_SIZE × IMAGE_SIZE using a second canvas. The browser
  // will use bilinear/bicubic depending on UA — both are fine for the model.
  const small: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(IMAGE_SIZE, IMAGE_SIZE)
      : Object.assign(document.createElement("canvas"), {
          width: IMAGE_SIZE,
          height: IMAGE_SIZE,
        });
  const sctx = small.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!sctx) return null;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  // Drawing the larger canvas as an image into the small one performs the
  // resample step in one call.
  sctx.drawImage(canvas as CanvasImageSource, 0, 0, IMAGE_SIZE, IMAGE_SIZE);

  const img = sctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
  const px = img.data; // RGBA, uint8
  const out = new Float32Array(IMAGE_SIZE * IMAGE_SIZE);
  // Grayscale = average of RGB (the canvas only has black/white ink so the
  // channels match), then invert: ink (low rgb) → 1, background → 0.
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
    out[j] = 1 - lum / 255;
  }
  return out;
}

export const HANDWRITING_INPUT_SIZE = IMAGE_SIZE;
