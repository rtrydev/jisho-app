// Fingerprint the handwriting recognizer model so its URL changes whenever the
// model bytes change. The loader (app/lib/handwriting/loader.ts) reads this
// manifest first, then requests the model with a `?v=<hash>` query string.
//
// Why: the model is served from a FIXED path (/data/kanji-recognizer.onnx)
// with `Cache-Control: immutable` (scripts/deploy.sh). Without a version stamp,
// a browser that cached the old model never re-fetches it after a retrain —
// `immutable` literally means "never revalidate this URL". Stamping the URL
// with a content hash turns a retrained model into a *new* URL, so every
// client picks it up, even ones holding the previous immutable copy.
//
// Runs at `prebuild` (so each deploy ships a stamp matching the bytes it
// uploads) and at `postinstall` (so a fresh clone has one for `next dev`). The
// output is gitignored — it's derived from the committed .onnx, not authored.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join("public", "data");
const MODEL = path.join(DATA_DIR, "kanji-recognizer.onnx");
const MANIFEST = path.join(DATA_DIR, "recognizer-manifest.json");

if (!fs.existsSync(MODEL)) {
  // No model yet (e.g. before `npm run data:fetch` or an OCR training run).
  // The loader falls back to the un-versioned URL, so this is non-fatal.
  console.log(
    `[fingerprint-recognizer] ${MODEL} not found — skipping manifest. ` +
      "Run `npm run data:fetch` or the OCR pipeline to produce it.",
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
    schema: "recognizer-manifest@1",
    model: "kanji-recognizer.onnx",
    version,
  }) + "\n";

// Only rewrite when the stamp actually changed, so installs/builds don't churn
// the file's mtime and trigger a needless `aws s3 sync` re-upload.
let prev = null;
try {
  prev = fs.readFileSync(MANIFEST, "utf8");
} catch {
  /* no existing manifest */
}

if (prev === json) {
  console.log(
    `[fingerprint-recognizer] ${MANIFEST} already current (version ${version})`,
  );
} else {
  fs.writeFileSync(MANIFEST, json);
  console.log(
    `[fingerprint-recognizer] wrote ${MANIFEST} (version ${version})`,
  );
}
