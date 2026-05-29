// Web Worker host for the kanji recognizer.
//
// Runs the entire recognition pipeline — model download + ONNX session
// creation, stroke preprocessing (OffscreenCanvas), left-to-right
// segmentation, and inference — off the main thread. A recognize pass can
// fire several ONNX runs (segmentation + confidence-driven re-splits); doing
// that here means it never blocks the pointer events that drive the drawing
// canvas, so a stroke always starts on touch even mid-recognition.
//
// The pipeline modules (loader / preprocess / segment / recognize /
// recognizeMulti) are environment-agnostic and run unchanged here: preprocess
// uses OffscreenCanvas, which workers provide. The main-thread channel only
// routes here when OffscreenCanvas exists (see recognizerChannel.ts), so
// preprocess never needs its `document.createElement` fallback in this context.

import { loadRecognizer, type RecognizerResources } from "./loader";
import { recognizeMulti } from "./recognizeMulti";
import type { FromWorkerMessage, ToWorkerMessage } from "./recognizerProtocol";
import type { Stroke } from "./types";

// `self` is typed as a Window under the DOM lib; narrow it to just the worker
// surface we use rather than pulling in the webworker lib (which conflicts
// with the DOM lib this project already targets).
const ctx = self as unknown as {
  postMessage: (msg: FromWorkerMessage) => void;
  onmessage: ((e: MessageEvent<ToWorkerMessage>) => void) | null;
};

function post(msg: FromWorkerMessage): void {
  ctx.postMessage(msg);
}

let resources: RecognizerResources | null = null;
let loadStarted = false;

async function handleLoad(): Promise<void> {
  // Idempotent: the channel posts `load` once, but guard anyway so a stray
  // duplicate can't kick off a second download.
  if (loadStarted) return;
  loadStarted = true;
  try {
    resources = await loadRecognizer((step, ratio) => {
      post({ type: "progress", step, ratio });
    });
    post({ type: "ready" });
  } catch (err) {
    post({
      type: "loadError",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleRecognize(
  id: number,
  strokes: Stroke[],
  topK: number,
): Promise<void> {
  try {
    if (!resources) throw new Error("Recognizer is not loaded yet.");
    const candidates = await recognizeMulti(strokes, resources, topK);
    post({ type: "result", id, candidates });
  } catch (err) {
    post({
      type: "recognizeError",
      id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

ctx.onmessage = (e: MessageEvent<ToWorkerMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case "load":
      void handleLoad();
      break;
    case "recognize":
      void handleRecognize(msg.id, msg.strokes, msg.topK);
      break;
  }
};
