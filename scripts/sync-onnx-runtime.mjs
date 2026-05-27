// Copy onnxruntime-web's WebAssembly artifacts into /public/onnx/ so the
// browser can fetch them at runtime. Runs as a postinstall step.
//
// At runtime, app code sets `ort.env.wasm.wasmPaths = '/onnx/'` so the
// runtime resolves these files via plain static fetches — matching the way
// /dict/ serves kuromoji's IPADIC binaries.

import fs from "node:fs";
import path from "node:path";

const src = path.join("node_modules", "onnxruntime-web", "dist");
const dst = path.join("public", "onnx");

if (!fs.existsSync(src)) process.exit(0);
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  // Ship only the .wasm artifacts and their matching .mjs glue files. JS
  // bundles for the runtime itself ship through the normal webpack chunk.
  if (!f.endsWith(".wasm") && !f.endsWith(".mjs")) continue;
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
