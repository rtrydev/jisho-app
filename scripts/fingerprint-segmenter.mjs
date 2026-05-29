// Fingerprint the character-boundary segmenter model so its URL changes
// whenever the model bytes change. Mirror of fingerprint-recognizer.mjs — the
// loader (app/lib/handwriting/loader.ts) reads this manifest first, then
// requests the model with a `?v=<hash>` query string.
//
// Why: the model is served from a FIXED path (/data/kanji-segmenter.onnx) with
// `Cache-Control: immutable`. Without a version stamp a browser that cached the
// old model never re-fetches it after a retrain. Stamping the URL with a
// content hash turns a retrained model into a *new* URL.
//
// Runs at `prebuild` and `postinstall`. The segmenter is optional: when it's
// absent the loader simply skips segmentation (whole drawing = one character),
// so a missing model here is non-fatal.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join("public", "data");
const MODEL = path.join(DATA_DIR, "kanji-segmenter.onnx");
const MANIFEST = path.join(DATA_DIR, "segmenter-manifest.json");

if (!fs.existsSync(MODEL)) {
  console.log(
    `[fingerprint-segmenter] ${MODEL} not found — skipping manifest. ` +
      "Run the OCR pipeline (segment-train + segment-export) to produce it.",
  );
  process.exit(0);
}

const bytes = fs.readFileSync(MODEL);
const version = crypto
  .createHash("sha256")
  .update(bytes)
  .digest("hex")
  .slice(0, 12);

const json =
  JSON.stringify({
    schema: "segmenter-manifest@1",
    model: "kanji-segmenter.onnx",
    version,
  }) + "\n";

let prev = null;
try {
  prev = fs.readFileSync(MANIFEST, "utf8");
} catch {
  /* no existing manifest */
}

if (prev === json) {
  console.log(
    `[fingerprint-segmenter] ${MANIFEST} already current (version ${version})`,
  );
} else {
  fs.writeFileSync(MANIFEST, json);
  console.log(`[fingerprint-segmenter] wrote ${MANIFEST} (version ${version})`);
}
