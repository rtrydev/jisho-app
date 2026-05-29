// Browser-only loader for the kanji-recognizer ONNX model and its paired
// class list. Mirrors the lazy-import pattern in `app/lib/engine/loader.ts`
// so the runtime never pulls onnxruntime-web in during SSR.
//
//   1. /data/kanji-classes.json    — ordered class list (index = model output)
//   2. /data/kanji-recognizer.onnx — int8-quantized MobileNetV3-Small
//
// WASM artifacts (ort-wasm-simd-threaded.wasm and friends) are served from
// /onnx/, copied there by scripts/sync-onnx-runtime.mjs at postinstall time.
//
// We import from `onnxruntime-web/wasm` rather than `onnxruntime-web` so the
// bundler picks the pure-WASM entry, which loads ort-wasm-simd-threaded.{mjs,
// wasm} — the only variant sync-onnx-runtime.mjs ships. The default entry
// pulls the JSEP build and would 404 on ort-wasm-simd-threaded.jsep.mjs.

import type { InferenceSession } from "onnxruntime-web";
import type { KanjiClassesManifest, RecognizerManifest } from "./types";

const CLASSES_URL = "/data/kanji-classes.json";
const MODEL_URL = "/data/kanji-recognizer.onnx";
const MODEL_MANIFEST_URL = "/data/recognizer-manifest.json";
const SEGMENTER_URL = "/data/kanji-segmenter.onnx";
const SEGMENTER_MANIFEST_URL = "/data/segmenter-manifest.json";
const WASM_PATHS = "/onnx/";

export type RecognizerResources = {
  classes: string[];
  session: InferenceSession;
  /** Character-boundary segmenter (splits a multi-character drawing). Null when
   *  the artifact is absent or failed to load — callers then fall back to
   *  treating the whole drawing as a single character. */
  segmenter: InferenceSession | null;
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

/**
 * Resolve the model URL with a content-hash cache-buster.
 *
 * The model is served from a fixed path with a long, immutable cache (see
 * scripts/deploy.sh), so retrained bytes at the same URL would be ignored by
 * any browser still holding the previous copy. scripts/fingerprint-recognizer.mjs
 * writes a short content hash into recognizer-manifest.json at build time;
 * appending it as `?v=<hash>` turns a new model into a new URL that every
 * client re-fetches. Falls back to the bare URL when the manifest is absent
 * (e.g. `next dev` before the script has run) — the dev server serves the
 * file regardless of the query string.
 */
async function resolveVersionedUrl(modelUrl: string, manifestUrl: string): Promise<string> {
  try {
    // `no-cache` forces a conditional request so a client always learns the
    // latest hash (a cheap 304 when unchanged); the manifest is tiny and
    // short-cached at the edge.
    const res = await fetch(manifestUrl, { cache: "no-cache" });
    if (res.ok) {
      const manifest = (await res.json()) as RecognizerManifest;
      if (typeof manifest.version === "string" && manifest.version) {
        return `${modelUrl}?v=${encodeURIComponent(manifest.version)}`;
      }
    }
  } catch {
    /* fall through to the un-versioned URL */
  }
  return modelUrl;
}

export function resolveModelUrl(): Promise<string> {
  return resolveVersionedUrl(MODEL_URL, MODEL_MANIFEST_URL);
}

async function loadSession(
  ort: typeof import("onnxruntime-web"),
  url: string,
  label: string,
  onProgress?: LoaderProgress,
): Promise<InferenceSession> {
  onProgress?.(label, 0);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${res.status}. Train + export the ` +
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
    onProgress?.(label, 1);
    return ort.InferenceSession.create(new Uint8Array(buf), sessionOptions());
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) onProgress?.(label, loaded / total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  onProgress?.(label, 1);
  return ort.InferenceSession.create(buf, sessionOptions());
}

/** Load the boundary segmenter. Best-effort: a missing/broken artifact resolves
 *  to null so the recognizer still works (whole drawing = one character). */
async function loadSegmenter(
  ort: typeof import("onnxruntime-web"),
  onProgress?: LoaderProgress,
): Promise<InferenceSession | null> {
  try {
    const url = await resolveVersionedUrl(SEGMENTER_URL, SEGMENTER_MANIFEST_URL);
    return await loadSession(ort, url, "Loading segmenter…", onProgress);
  } catch (err) {
    console.warn(
      "[handwriting] boundary segmenter unavailable — falling back to " +
        "single-character recognition (multi-character drawings won't split):",
      err,
    );
    return null;
  }
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
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = WASM_PATHS;
    // Threading wants COOP/COEP headers we don't set; force single-thread.
    ort.env.wasm.numThreads = 1;
    // ORT-web's OWN proxy worker stays OFF: it misbehaves with more than one
    // session in it — once the boundary segmenter was added (a second session),
    // proxying corrupted the recognizer's results (clean 日 → 已). We offload to
    // the main thread instead via our OWN dedicated worker (recognizer.worker.ts
    // / recognizerClient.ts), which owns both sessions in one context and so
    // never hits that bug. This module runs inside that worker (and on the main
    // thread for the no-worker fallback); either way ORT's proxy must be off.
    ort.env.wasm.proxy = false;

    const recognizerUrl = await resolveModelUrl();
    const [classes, session] = await Promise.all([
      loadClasses(onProgress),
      loadSession(ort, recognizerUrl, "Loading recognizer model…", onProgress),
    ]);
    // Create the segmenter session *after* the recognizer rather than
    // concurrently: under `wasm.proxy = true` both sessions share one worker,
    // and racing two InferenceSession.create calls through its init has been a
    // source of flaky second-session failures. Sequencing costs a little load
    // time and removes the race.
    const segmenter = await loadSegmenter(ort);
    return { classes, session, segmenter };
  })();
  return _resourcesPromise;
}

/** Drop the cached promise so the next `loadRecognizer` call re-fetches. Used
 *  by the error-recovery path; not normally needed. */
export function resetRecognizer(): void {
  _resourcesPromise = null;
}
