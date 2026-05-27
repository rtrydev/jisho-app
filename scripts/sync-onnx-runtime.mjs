// Copy the single ONNX Runtime variant we actually use into /public/onnx/.
// At runtime, app code sets `ort.env.wasm.wasmPaths = '/onnx/'` and
// `ort.env.wasm.numThreads = 1`, so only the SIMD-threaded WASM EP variant
// is loaded. The asyncify / jsep / jspi variants ship in the npm package
// but we don't enable any of those execution providers — historically we
// copied everything and ended up bundling ~90 MB of dead WASM into the
// static export.
//
// Files copied:
//   * ort-wasm-simd-threaded.wasm   — the actual binary (~13 MB)
//   * ort-wasm-simd-threaded.mjs    — the glue script (~24 KB)
//
// To re-enable an alternate execution provider, add its variant prefix
// here AND update the call site in app/lib/handwriting/loader.ts.

import fs from "node:fs";
import path from "node:path";

const KEEP = new Set([
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
]);

const src = path.join("node_modules", "onnxruntime-web", "dist");
const dst = path.join("public", "onnx");

if (!fs.existsSync(src)) process.exit(0);

// Clear out previously-copied files so a freshly-pruned set replaces a
// possibly-stale superset from earlier installs.
if (fs.existsSync(dst)) {
  for (const f of fs.readdirSync(dst)) {
    if (!KEEP.has(f)) {
      try {
        fs.unlinkSync(path.join(dst, f));
      } catch {
        /* best-effort */
      }
    }
  }
}

fs.mkdirSync(dst, { recursive: true });
for (const f of KEEP) {
  const from = path.join(src, f);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(dst, f));
  }
}
