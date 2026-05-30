// Message protocol between the main thread (recognizerClient.ts) and the
// dedicated inference worker (recognizer.worker.ts).
//
// Strokes are plain `{x, y}` arrays and candidates are plain objects, so both
// directions are structured-cloneable with no special transfer handling. The
// camera path sends already-normalized 96×96 cells (Float32Array), which are
// likewise structured-cloneable.

import type { Candidate, Stroke } from "./types";

/** Main thread → worker. */
export type WorkerRequest =
  | { type: "init" }
  | { type: "recognize"; id: number; strokes: Stroke[]; topK: number }
  // Camera mode: the main thread does the pixel pre-stage (foreground
  // extraction + segmentation + normalize, see imagePreprocess.ts) and sends
  // one preprocessed 96×96 cell per detected character. The worker only runs
  // the recognizer — no segmentation — and returns top-K per cell.
  | { type: "recognizeImage"; id: number; cells: Float32Array[]; topK: number };

/** Worker → main thread. */
export type WorkerResponse =
  | { type: "progress"; step: string; ratio: number }
  | { type: "ready" }
  | { type: "initError"; message: string }
  | { type: "result"; id: number; candidates: Candidate[][] }
  | { type: "error"; id: number; message: string };
