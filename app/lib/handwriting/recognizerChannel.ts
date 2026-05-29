"use client";

// Main-thread side of the recognizer. Owns the Web Worker, routes load +
// recognize requests to it, and matches each `recognize` reply back to its
// caller by request id.
//
// Two backends behind one interface:
//
//   • WorkerChannel — the default. Inference runs off the main thread, so a
//     long recognize pass never blocks the canvas pointer events.
//   • MainThreadChannel — fallback for environments without a usable worker
//     path (no `Worker`, or no `OffscreenCanvas` for preprocess to render
//     into; see `canUseWorker`). Runs the same pipeline inline.
//
// The chosen backend is a module-level singleton so the model loads once and
// stays resident across canvas mount/unmount.

import type { LoaderProgress, RecognizerResources } from "./loader";
import type { FromWorkerMessage, ToWorkerMessage } from "./recognizerProtocol";
import type { Candidate, Stroke } from "./types";

export interface RecognizerChannel {
  /** Start (or re-await) the one-time model load. Resolves when the recognizer
   *  is ready; rejects on a load failure. The latest `onProgress` wins. */
  load(onProgress?: LoaderProgress): Promise<void>;
  /** Segment + recognize. Resolves to one Candidate[] per detected character. */
  recognize(strokes: Stroke[], topK: number): Promise<Candidate[][]>;
}

type PendingRecognize = {
  resolve: (candidates: Candidate[][]) => void;
  reject: (err: Error) => void;
};

class WorkerChannel implements RecognizerChannel {
  private readonly worker: Worker;
  private loadPromise: Promise<void> | null = null;
  private loadResolve: (() => void) | null = null;
  private loadReject: ((err: Error) => void) | null = null;
  private onProgress?: LoaderProgress;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRecognize>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent<FromWorkerMessage>) =>
      this.handle(e.data);
    // A worker-level error (script load failure, uncaught throw) can't be tied
    // to one request, so fail everything in flight.
    this.worker.onerror = (e) =>
      this.fail(new Error(e.message || "Recognizer worker crashed."));
    this.worker.onmessageerror = () =>
      this.fail(new Error("Recognizer worker sent an unreadable message."));
  }

  load(onProgress?: LoaderProgress): Promise<void> {
    if (onProgress) this.onProgress = onProgress;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = new Promise<void>((resolve, reject) => {
      this.loadResolve = resolve;
      this.loadReject = reject;
    });
    this.worker.postMessage({ type: "load" } satisfies ToWorkerMessage);
    return this.loadPromise;
  }

  recognize(strokes: Stroke[], topK: number): Promise<Candidate[][]> {
    const id = this.nextId++;
    return new Promise<Candidate[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        type: "recognize",
        id,
        strokes,
        topK,
      } satisfies ToWorkerMessage);
    });
  }

  private handle(msg: FromWorkerMessage): void {
    switch (msg.type) {
      case "progress":
        this.onProgress?.(msg.step, msg.ratio);
        break;
      case "ready":
        this.loadResolve?.();
        break;
      case "loadError":
        this.loadReject?.(new Error(msg.message));
        break;
      case "result": {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve(msg.candidates);
        }
        break;
      }
      case "recognizeError": {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.reject(new Error(msg.message));
        }
        break;
      }
    }
  }

  private fail(err: Error): void {
    this.loadReject?.(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

class MainThreadChannel implements RecognizerChannel {
  private resources: RecognizerResources | null = null;
  private loadPromise: Promise<void> | null = null;

  load(onProgress?: LoaderProgress): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      // Dynamic import so onnxruntime-web only enters the main bundle on this
      // fallback path — the common path keeps it confined to the worker chunk.
      const { loadRecognizer } = await import("./loader");
      this.resources = await loadRecognizer(onProgress);
    })();
    return this.loadPromise;
  }

  async recognize(strokes: Stroke[], topK: number): Promise<Candidate[][]> {
    if (!this.resources) return [];
    const { recognizeMulti } = await import("./recognizeMulti");
    return recognizeMulti(strokes, this.resources, topK);
  }
}

/**
 * Whether the worker path is viable. The worker preprocesses strokes with
 * OffscreenCanvas; preprocess.ts's `document.createElement` fallback can't run
 * in a worker, and OffscreenCanvas support is identical on the main thread and
 * in a worker — so this is a reliable gate. `Worker` is also absent during SSR.
 */
function canUseWorker(): boolean {
  return (
    typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined"
  );
}

let channel: RecognizerChannel | null = null;

/** Lazily create (and cache) the recognizer channel for this session. */
export function getRecognizerChannel(): RecognizerChannel {
  if (channel) return channel;
  if (canUseWorker()) {
    try {
      const worker = new Worker(
        new URL("./recognizer.worker.ts", import.meta.url),
        { type: "module" },
      );
      channel = new WorkerChannel(worker);
      return channel;
    } catch {
      // Worker construction can throw under strict CSP or an unusual host;
      // fall back to running the pipeline on the main thread.
    }
  }
  channel = new MainThreadChannel();
  return channel;
}
