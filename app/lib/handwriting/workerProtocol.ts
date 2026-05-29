// Message protocol between the main thread (recognizerClient.ts) and the
// dedicated inference worker (recognizer.worker.ts).
//
// Strokes are plain `{x, y}` arrays and candidates are plain objects, so both
// directions are structured-cloneable with no special transfer handling.

import type { Candidate, Stroke } from "./types";

/** Main thread → worker. */
export type WorkerRequest =
  | { type: "init" }
  | { type: "recognize"; id: number; strokes: Stroke[]; topK: number };

/** Worker → main thread. */
export type WorkerResponse =
  | { type: "progress"; step: string; ratio: number }
  | { type: "ready" }
  | { type: "initError"; message: string }
  | { type: "result"; id: number; candidates: Candidate[][] }
  | { type: "error"; id: number; message: string };
