// Message protocol between the main thread (recognizerClient.ts) and the
// dedicated inference worker (recognizer.worker.ts).
//
// Strokes are plain `{x, y}` arrays and candidates are plain objects, so both
// directions are structured-cloneable with no special transfer handling. The
// camera path sends the cropped frame's RGBA pixels as an ArrayBuffer, which
// the client passes in the postMessage transfer list — moved, not cloned, so
// a ~MB crop costs nothing to hand over.

import type { Candidate, Stroke } from "./types";
import type { ReadAxis } from "./imagePreprocess";

/** Main thread → worker. */
export type WorkerRequest =
  | { type: "init" }
  | { type: "recognize"; id: number; strokes: Stroke[]; topK: number }
  // Camera mode: the main thread only grabs the frame and crops it to the
  // guide box; the WHOLE pixel pipeline — foreground extraction, multi-line
  // segmentation, cell normalization (imagePreprocess.ts) — plus per-cell
  // recognition runs in the worker. Keeping the pipeline off the main thread
  // matters on phones: it is several full-image passes and multiple
  // flood-fill labelings over a ~1 MP crop, enough sustained main-thread CPU
  // for iOS Safari to kill the tab.
  | {
      type: "readImage";
      id: number;
      /** RGBA bytes of the cropped ImageData (transferred, not cloned). */
      pixels: ArrayBuffer;
      width: number;
      height: number;
      axis: ReadAxis;
      topK: number;
    };

/** Worker → main thread. */
export type WorkerResponse =
  | { type: "progress"; step: string; ratio: number }
  | { type: "ready" }
  | { type: "initError"; message: string }
  | { type: "result"; id: number; candidates: Candidate[][] }
  | { type: "error"; id: number; message: string };
