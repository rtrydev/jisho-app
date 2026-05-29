// Pull pre-built dictionary artifacts from the live deployment so a fresh
// clone can run the app without setting up the full Python data pipeline.
//
// What this fetches:
//
//   * /data/dictionary.json.gz   — primary vocab + readings + linked sentences
//   * /data/gloss-index.json.gz  — EN→JP reverse index
//   * /data/grammar.json.gz      — merged grammar bank
//   * /data/grammar-manifest.json — loader manifest
//   * /data/ATTRIBUTION.md       — EDRDG license requirement
//   * /data/build-manifest.json  — recorded source checksums + counts
//
// And, when production has them deployed (will 404 cleanly otherwise):
//
//   * /data/kanji.json.gz        — Stage 7 per-kanji metadata
//   * /data/radkfile.json.gz     — Stage 7 radical → kanji map
//   * /data/kanji-classes.json   — OCR class index
//   * /data/kanji-recognizer.onnx — OCR INT8 model
//   * /data/kanji-segmenter.onnx  — character-boundary model (Draw mode)
//
// When the experimental artifacts 404, the script logs a hint that those
// features need a local pipeline / training run and continues.
//
// To rebuild from upstream EDRDG sources instead of fetching:
//   python -m tools.data_pipeline.fetch     # download sources
//   python -m tools.data_pipeline           # produce artifacts
//   python -m tools.handwriting_ocr ...     # for the OCR model

import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const BASE_URL = process.env.JISHO_DATA_BASE ?? "https://jisho.rtrydev.com";
const DEST_DIR = path.join("public", "data");

const REQUIRED = [
  "dictionary.json.gz",
  "gloss-index.json.gz",
  "grammar.json.gz",
  "grammar-manifest.json",
  "ATTRIBUTION.md",
  "build-manifest.json",
];

const OPTIONAL = [
  "kanji.json.gz",
  "radkfile.json.gz",
  "kanji-classes.json",
  "kanji-recognizer.onnx",
  "kanji-segmenter.onnx",
];

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

function humanBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function fetchOne(name, { optional }) {
  const dest = path.join(DEST_DIR, name);
  if (!force && fs.existsSync(dest)) {
    const sz = fs.statSync(dest).size;
    console.error(`  · ${name}  exists (${humanBytes(sz)}) — skip (use --force to refetch)`);
    return "cached";
  }
  const url = `${BASE_URL}/data/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (optional && res.status === 404) {
      console.error(`  · ${name}  not on production yet (404) — build it locally with the data pipeline`);
      return "missing";
    }
    throw new Error(`${name}: HTTP ${res.status} from ${url}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  const sz = fs.statSync(dest).size;
  console.error(`  · ${name}  ${humanBytes(sz)}`);
  return "fetched";
}

async function main() {
  console.error(`Fetching from ${BASE_URL}/data/ → ${DEST_DIR}/`);
  console.error("");
  console.error("Required (v1 analysis engine):");
  for (const name of REQUIRED) {
    await fetchOne(name, { optional: false });
  }
  console.error("");
  console.error("Optional (radical-search + handwriting picker):");
  let missing = 0;
  for (const name of OPTIONAL) {
    const status = await fetchOne(name, { optional: true });
    if (status === "missing") missing += 1;
  }
  if (missing > 0) {
    console.error("");
    console.error(
      `${missing} optional artifact(s) not yet on production. To build them locally:`,
    );
    console.error("  python -m tools.data_pipeline.fetch    # download EDRDG sources");
    console.error("  python -m tools.data_pipeline          # produce kanji.json.gz + radkfile.json.gz");
    console.error("  python -m tools.handwriting_ocr classes    # OCR class list");
    console.error("  python -m tools.handwriting_ocr fetch-kanjivg");
    console.error("  python -m tools.handwriting_ocr train --arch simple_resnet --num-workers 8");
    console.error("  python -m tools.handwriting_ocr export --arch simple_resnet");
  }
  console.error("");
  console.error("Done. Run `npm run dev` and open the app.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
