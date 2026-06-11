// Dedicated inference worker.
//
// Owns BOTH ONNX sessions (recognizer + boundary segmenter) and runs the whole
// pipeline — preprocess → segment → recognize → softmax — off the main thread,
// so a forward pass never blocks the Draw canvas. The camera path runs here
// too: the cropped frame arrives as a transferred RGBA buffer and the full
// pixel pipeline (imagePreprocess.ts) executes in this context — on a phone
// that pipeline is heavy enough to hang the main thread for seconds, which is
// exactly what iOS Safari kills tabs for. Strokes come in as plain arrays and
// candidates go back as plain objects (see workerProtocol.ts).
//
// Why our own worker instead of ORT-web's `wasm.proxy`: the proxy worker
// corrupts results when more than one session shares it (clean 日 → 已 once the
// segmenter was added — see loader.ts). Running both sessions ourselves, in one
// worker context, sidesteps that entirely.
//
// `loadRecognizer` and `recognizeMulti` are DOM-free (fetch + ORT + an
// OffscreenCanvas, all available in a worker), so they run here unchanged. The
// preprocessing canvases take the OffscreenCanvas branch automatically; the
// `document.createElement` fallback is never hit here (and the client only
// spawns this worker when OffscreenCanvas is supported).

import { imageToCells } from "./imagePreprocess";
import { loadRecognizer, type RecognizerResources } from "./loader";
import { recognize, recognizeBatch } from "./recognize";
import { recognizeMulti } from "./recognizeMulti";
import type { Candidate } from "./types";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

// `self` is typed as the DOM `Window` under the project's `dom` lib; re-type the
// handle we use rather than pulling in the `webworker` lib (which collides with
// `dom` on shared globals). Casting through `unknown` keeps it local + safe.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

let resourcesPromise: Promise<RecognizerResources> | null = null;

function post(message: WorkerResponse): void {
  ctx.postMessage(message);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      resourcesPromise ??= loadRecognizer((step, ratio) =>
        post({ type: "progress", step, ratio }),
      );
      await resourcesPromise;
      post({ type: "ready" });
    } catch (err) {
      post({
        type: "initError",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "recognize") {
    try {
      // `init` runs first in practice (the client awaits `ready` before issuing
      // any recognize), but tolerate a bare recognize by loading on demand.
      resourcesPromise ??= loadRecognizer();
      const resources = await resourcesPromise;
      const candidates = await recognizeMulti(msg.strokes, resources, msg.topK);
      post({ type: "result", id: msg.id, candidates });
    } catch (err) {
      post({
        type: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "readImage") {
    try {
      resourcesPromise ??= loadRecognizer();
      const resources = await resourcesPromise;
      // The camera path: rebuild the cropped frame from the transferred RGBA
      // buffer and run the WHOLE pixel pipeline here — foreground extraction,
      // multi-line segmentation, cell normalization (imagePreprocess.ts uses
      // OffscreenCanvas, available in this context) — then the recognizer on
      // each cell, in reading order. One Candidate[] per cell — the same shape
      // recognizeMulti returns, so the camera path flows through the Draw-mode
      // candidate UI unchanged.
      const image = new ImageData(
        new Uint8ClampedArray(msg.pixels),
        msg.width,
        msg.height,
      );
      const cells = imageToCells(image, msg.axis);
      // All cells in one batched run (one graph execution instead of N — the
      // sustained-CPU profile of N sequential runs is what got the tab killed
      // on iOS). The per-cell loop stays as a safety net in case a deployed
      // model predates the dynamic batch axis.
      let candidates: Candidate[][];
      try {
        candidates = await recognizeBatch(resources, cells, msg.topK);
      } catch (batchErr) {
        console.warn(
          "[handwriting] batched inference failed; falling back to per-cell runs:",
          batchErr,
        );
        candidates = [];
        for (const cell of cells) {
          candidates.push(await recognize(resources, cell, msg.topK));
        }
      }
      post({ type: "result", id: msg.id, candidates });
    } catch (err) {
      post({
        type: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
