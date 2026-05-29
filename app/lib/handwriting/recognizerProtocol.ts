// Message protocol shared between the recognizer Web Worker
// (recognizer.worker.ts) and the main-thread channel (recognizerChannel.ts).
//
// Type-only module — no runtime code — so importing it into the worker bundle
// costs nothing and keeps the two ends of the channel from drifting apart.

import type { Candidate, Stroke } from "./types";

/** Main thread → worker. */
export type ToWorkerMessage =
  | { type: "load" }
  | { type: "recognize"; id: number; strokes: Stroke[]; topK: number };

/** Worker → main thread. `id` echoes the `recognize` request it answers. */
export type FromWorkerMessage =
  | { type: "progress"; step: string; ratio: number }
  | { type: "ready" }
  | { type: "loadError"; message: string }
  | { type: "result"; id: number; candidates: Candidate[][] }
  | { type: "recognizeError"; id: number; message: string };
