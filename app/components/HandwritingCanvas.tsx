"use client";

// HandwritingCanvas — captures pointer-driven strokes for the kanji
// handwriting recognizer.
//
// Controlled component: the parent owns the `strokes` array, so undo/clear
// reduce to slicing the array. The canvas itself only tracks the *active*
// in-flight stroke (in a ref so pointer-move doesn't re-render React).
//
// Theme-aware: stroke color is read from the live `--ink` CSS variable, so
// it switches with light/dark/accent. Background is transparent — the
// CSS-side container draws the paper-sink surface.

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
} from "react";
import type { Stroke } from "../lib/handwriting/types";

type Point = { x: number; y: number };

const STROKE_WIDTH = 4;

function readInkColor(): string {
  if (typeof window === "undefined") return "#1a1612";
  const css = getComputedStyle(document.documentElement);
  const v = css.getPropertyValue("--ink").trim();
  return v || "#1a1612";
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = readInkColor();
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function HandwritingCanvas({
  strokes,
  onStrokesChange,
  size = 280,
  disabled = false,
  className,
}: {
  strokes: Stroke[];
  onStrokesChange?: (next: Stroke[]) => void;
  /** CSS pixels — backing store scales by devicePixelRatio. */
  size?: number;
  /** Block new strokes (e.g. while the model is still loading). */
  disabled?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStroke = useRef<Point[] | null>(null);

  // Size the backing store at the current DPR. Kept separate from the repaint
  // below because assigning `canvas.width`/`height` reallocates and clears the
  // whole backing store — doing that on every committed stroke is needless
  // main-thread work that adds latency between strokes on mobile. This only
  // runs on mount and when `size` changes; the transform it sets persists for
  // both the repaint effect and the live pointer drawing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [size]);

  // Repaint all committed strokes. Runs on `strokes` changes (undo, clear,
  // external mutation) and after a resize — a cheap clear + replay, no backing-
  // store reallocation.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    applyStrokeStyle(ctx);
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) {
        // Single point — render a filled dot at line-width radius.
        ctx.lineTo(stroke[0].x + 0.01, stroke[0].y + 0.01);
      } else {
        for (let i = 1; i < stroke.length; i++) {
          ctx.lineTo(stroke[i].x, stroke[i].y);
        }
      }
      ctx.stroke();
    }
  }, [size, strokes]);

  /** Translate a pointer event into canvas-local coordinates. */
  const pointFor = useCallback(
    (e: PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * size) / rect.width,
        y: ((e.clientY - rect.top) * size) / rect.height,
      };
    },
    [size],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      // Only primary pointer (left mouse, single touch, pen tip).
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      const canvas = canvasRef.current!;
      canvas.setPointerCapture(e.pointerId);
      const p = pointFor(e);
      activeStroke.current = [p];

      const ctx = canvas.getContext("2d");
      if (ctx) {
        applyStrokeStyle(ctx);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        // Tiny lineTo so a tap with no move still leaves a dot.
        ctx.lineTo(p.x + 0.01, p.y + 0.01);
        ctx.stroke();
      }
    },
    [disabled, pointFor],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      const active = activeStroke.current;
      if (!active) return;
      e.preventDefault();
      const p = pointFor(e);
      const prev = active[active.length - 1];
      // Skip sub-pixel duplicates so the stroke point list stays compact.
      if (Math.abs(p.x - prev.x) < 0.5 && Math.abs(p.y - prev.y) < 0.5) return;
      active.push(p);

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    },
    [pointFor],
  );

  const finishStroke = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      const active = activeStroke.current;
      if (!active) return;
      activeStroke.current = null;
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore — capture may already be lost */
      }
      if (active.length === 0) return;
      onStrokesChange?.([...strokes, active]);
    },
    [strokes, onStrokesChange],
  );

  return (
    <canvas
      ref={canvasRef}
      className={["hw-canvas", className].filter(Boolean).join(" ")}
      role="img"
      aria-label="Drawing area for kanji handwriting input"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      style={{ touchAction: "none" }}
    />
  );
}
