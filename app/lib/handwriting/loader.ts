// Browser-only loader for the kanji-recognizer ONNX model and its paired
// class list. Mirrors the lazy-import pattern in `app/lib/engine/loader.ts`
// so the runtime never pulls onnxruntime-web in during SSR.
//
//   1. /data/kanji-classes.json    — ordered class list (index = model output)
//   2. /data/kanji-recognizer.onnx — int8-quantized MobileNetV3-Small
//
// WASM artifacts (ort-wasm-simd-threaded.wasm and friends) are served from
// /onnx/, copied there by scripts/sync-onnx-runtime.mjs at postinstall time.

import type { InferenceSession } from "onnxruntime-web";
import type { KanjiClassesManifest } from "./types";

const CLASSES_URL = "/data/kanji-classes.json";
const MODEL_URL = "/data/kanji-recognizer.onnx";
const WASM_PATHS = "/onnx/";

export type RecognizerResources = {
  classes: string[];
  session: InferenceSession;
};

export type LoaderProgress = (step: string, ratio: number) => void;

async function loadClasses(onProgress?: LoaderProgress): Promise<string[]> {
  onProgress?.("Loading class list…", 0);
  const res = await fetch(CLASSES_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${CLASSES_URL}: ${res.status}. Run the OCR pipeline ` +
        `to produce it (see tools/handwriting_ocr/README.md).`,
    );
  }
  const manifest = (await res.json()) as KanjiClassesManifest;
  if (!Array.isArray(manifest.classes) || manifest.classes.length === 0) {
    throw new Error(`${CLASSES_URL} is empty or malformed.`);
  }
  onProgress?.("Loading class list…", 1);
  return manifest.classes;
}

async function loadSession(
  ort: typeof import("onnxruntime-web"),
  onProgress?: LoaderProgress,
): Promise<InferenceSession> {
  onProgress?.("Loading recognizer model…", 0);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${MODEL_URL}: ${res.status}. Train + export the ` +
        `model (see tools/handwriting_ocr/README.md).`,
    );
  }
  // Stream into an ArrayBuffer with progress so the loading sheet can show
  // something for the bulk download. `Content-Length` is set by CloudFront /
  // most static hosts; fall back to indeterminate when unavailable.
  const total = parseInt(res.headers.get("Content-Length") ?? "0", 10) || 0;
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    onProgress?.("Loading recognizer model…", 1);
    return ort.InferenceSession.create(new Uint8Array(buf), sessionOptions());
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) onProgress?.("Loading recognizer model…", loaded / total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  onProgress?.("Loading recognizer model…", 1);
  return ort.InferenceSession.create(buf, sessionOptions());
}

function sessionOptions(): import("onnxruntime-web").InferenceSession.SessionOptions {
  return {
    // Single-threaded WASM is plenty for a ~5 MB int8 model and avoids the
    // cross-origin-isolation requirement that threaded WASM has on the web.
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
    // The model has a static input shape per batch; freeing intermediate
    // buffers between runs reduces peak memory on mobile.
    enableMemPattern: true,
  };
}

let _resourcesPromise: Promise<RecognizerResources> | null = null;

/** Lazy-init the recognizer. Subsequent calls return the cached promise. */
export function loadRecognizer(
  onProgress?: LoaderProgress,
): Promise<RecognizerResources> {
  if (_resourcesPromise) return _resourcesPromise;
  _resourcesPromise = (async () => {
    // Dynamic import keeps onnxruntime-web out of the SSR build.
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = WASM_PATHS;
    // Threading wants COOP/COEP headers we don't set; force single-thread.
    ort.env.wasm.numThreads = 1;

    const [classes, session] = await Promise.all([
      loadClasses(onProgress),
      loadSession(ort, onProgress),
    ]);
    return { classes, session };
  })();
  return _resourcesPromise;
}

/** Drop the cached promise so the next `loadRecognizer` call re-fetches. Used
 *  by the error-recovery path; not normally needed. */
export function resetRecognizer(): void {
  _resourcesPromise = null;
}
