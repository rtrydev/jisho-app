"use client";

// Main-thread side of the dedicated inference worker.
//
// `createRecognizerClient` spawns recognizer.worker.ts and exposes a small
// `recognize(strokes, topK)` surface, correlating each request with its
// response by id. The worker does all the compute (preprocess + segment +
// recognize), so the Draw canvas never blocks on a forward pass.
//
// Robustness: if the environment lacks Worker/OffscreenCanvas, or the worker
// fails to initialise, we transparently fall back to running the same pipeline
// on the main thread — recognition still works, it just isn't offloaded.

import type { Candidate, Stroke } from "./types";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

export type RecognizerProgress = (step: string, ratio: number) => void;

export interface RecognizerClient {
  /** Segment + recognize a drawing; one Candidate[] per detected character. */
  recognize(strokes: Stroke[], topK: number): Promise<Candidate[][]>;
  /** Tear down the worker (if any). Idempotent. */
  dispose(): void;
}

export interface RecognizerHandle {
  /** Resolves when the model(s) are loaded and the client is ready to
   *  recognize; rejects if both the worker and the fallback fail to load. */
  ready: Promise<void>;
  client: RecognizerClient;
}

/** Worker offload needs both a Worker and OffscreenCanvas (the worker renders
 *  strokes with OffscreenCanvas; there is no `document` to fall back to). */
function supportsWorkerOffload(): boolean {
  return (
    typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
  );
}

/** The fallback path: load the model(s) and run the pipeline on the main
 *  thread. Both imports are dynamic so onnxruntime-web stays out of the main
 *  bundle and only loads if/when this path is actually used. */
function createMainThreadClient(onProgress?: RecognizerProgress): RecognizerHandle {
  const resourcesPromise = import("./loader").then(({ loadRecognizer }) =>
    loadRecognizer(onProgress),
  );
  const client: RecognizerClient = {
    async recognize(strokes, topK) {
      const [{ recognizeMulti }, resources] = await Promise.all([
        import("./recognizeMulti"),
        resourcesPromise,
      ]);
      return recognizeMulti(strokes, resources, topK);
    },
    dispose() {
      /* nothing to tear down on the main thread */
    },
  };
  return { ready: resourcesPromise.then(() => undefined), client };
}

/** The worker path, with a transparent fall-through to the main thread if the
 *  worker can't be created or fails before it signals `ready`. */
function createWorkerClient(onProgress?: RecognizerProgress): RecognizerHandle {
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./recognizer.worker.ts", import.meta.url),
      { type: "module" },
    );
  } catch (err) {
    console.warn(
      "[handwriting] worker construction failed; running inference on the " +
        "main thread instead:",
      err,
    );
    return createMainThreadClient(onProgress);
  }

  const pending = new Map<
    number,
    { resolve: (c: Candidate[][]) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;

  // `impl` is the active recognizer. It starts as the worker-backed one and is
  // swapped for a main-thread client if init falls back (see `ready` below).
  const workerImpl: RecognizerClient = {
    recognize(strokes, topK) {
      return new Promise<Candidate[][]>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const req: WorkerRequest = { type: "recognize", id, strokes, topK };
        worker.postMessage(req);
      });
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
  let impl: RecognizerClient = workerImpl;

  const ready = new Promise<void>((resolve, reject) => {
    let settled = false;
    let fellBack = false;

    const fallBack = (reason: string) => {
      if (fellBack || settled) return;
      fellBack = true;
      console.warn(
        "[handwriting] inference worker unavailable; falling back to the " +
          "main thread:",
        reason,
      );
      worker.terminate();
      pending.clear();
      const mt = createMainThreadClient(onProgress);
      impl = mt.client;
      mt.ready.then(resolve, reject);
    };

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      switch (msg.type) {
        case "progress":
          onProgress?.(msg.step, msg.ratio);
          break;
        case "ready":
          settled = true;
          resolve();
          break;
        case "initError":
          fallBack(msg.message);
          break;
        case "result": {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.resolve(msg.candidates);
          }
          break;
        }
        case "error": {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.reject(new Error(msg.message));
          }
          break;
        }
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      // An error before `ready` means the worker never came up — fall back.
      // After `ready`, surface it (a per-request error already rejects via the
      // "error" message; this catches anything else).
      if (!settled) fallBack(e.message || "worker error");
    };

    const init: WorkerRequest = { type: "init" };
    worker.postMessage(init);
  });

  const client: RecognizerClient = {
    recognize: (strokes, topK) => impl.recognize(strokes, topK),
    dispose: () => impl.dispose(),
  };

  return { ready, client };
}

/** Create a recognizer client, preferring the worker offload and degrading to
 *  main-thread inference where unsupported. */
export function createRecognizerClient(
  onProgress?: RecognizerProgress,
): RecognizerHandle {
  if (supportsWorkerOffload()) return createWorkerClient(onProgress);
  return createMainThreadClient(onProgress);
}
