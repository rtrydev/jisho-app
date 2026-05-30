// Dedicated inference worker.
//
// Owns BOTH ONNX sessions (recognizer + boundary segmenter) and runs the whole
// pipeline — preprocess → segment → recognize → softmax — off the main thread,
// so a forward pass never blocks the Draw canvas. The strokes come in as plain
// arrays and the candidates go back as plain objects (see workerProtocol.ts).
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

import { loadRecognizer, type RecognizerResources } from "./loader";
import { recognize } from "./recognize";
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

  if (msg.type === "recognizeImage") {
    try {
      resourcesPromise ??= loadRecognizer();
      const resources = await resourcesPromise;
      // Cells arrive already segmented + normalized (imagePreprocess.ts), so we
      // just run the single-character recognizer on each, in order. One
      // Candidate[] per cell — the same shape recognizeMulti returns, so the
      // camera path flows through the Draw-mode candidate UI unchanged.
      const candidates: Candidate[][] = [];
      for (const cell of msg.cells) {
        candidates.push(await recognize(resources, cell, msg.topK));
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
