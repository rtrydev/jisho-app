// Browser-only resource loader. Fetches the three static assets the engine
// needs and resolves to a ready-to-use EngineResources bundle.
//
//   1. /data/dictionary.json.gz   — compiled JMdict (gzip + JSON)
//   2. /data/grammar-manifest.json — declares the merged grammar artifact
//   3. /data/grammar.json.gz       — the merged Yomitan v3 entry list
//   4. /dict/*.dat.gz              — Kuromoji IPADIC binary dictionary
//
// The kuromoji import path is browser-only — this module must not be loaded
// during SSR.

import { ungzip } from "pako";
import type {
  Dictionary,
  EngineResources,
  GlossIndex,
  GrammarEntry,
  GrammarManifest,
  GrammarMap,
  TokenizerLike,
} from "./types";

export type LoaderProgress = (step: string, ratio: number) => void;

const ASSET_BASE = "/data";
const KUROMOJI_DICT_PATH = "/dict/";

async function fetchProgress(
  url: string,
  onChunk?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const lenHeader = res.headers.get("Content-Length");
  const total = lenHeader ? parseInt(lenHeader, 10) : 0;
  if (!res.body || total === 0) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onChunk?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

async function loadDictionary(onProgress?: LoaderProgress): Promise<Dictionary> {
  const buf = await fetchProgress(`${ASSET_BASE}/dictionary.json.gz`, (l, t) =>
    onProgress?.("Loading dictionary…", l / t),
  );
  const json = ungzip(new Uint8Array(buf), { to: "string" });
  return JSON.parse(json) as Dictionary;
}

async function loadGlossIndex(onProgress?: LoaderProgress): Promise<GlossIndex> {
  const buf = await fetchProgress(`${ASSET_BASE}/gloss-index.json.gz`, (l, t) =>
    onProgress?.("Loading reverse index…", l / t),
  );
  const json = ungzip(new Uint8Array(buf), { to: "string" });
  return JSON.parse(json) as GlossIndex;
}

async function loadGrammar(onProgress?: LoaderProgress): Promise<GrammarMap> {
  const manifestRes = await fetch(`${ASSET_BASE}/grammar-manifest.json`);
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch grammar manifest: ${manifestRes.status}`);
  }
  const manifest = (await manifestRes.json()) as GrammarManifest;
  const map: GrammarMap = new Map();
  for (let i = 0; i < manifest.artifacts.length; i++) {
    const artifact = manifest.artifacts[i];
    const url = `${ASSET_BASE}/${artifact.path}`;
    const buf = await fetchProgress(url, (l, t) =>
      onProgress?.(
        `Loading grammar (${i + 1}/${manifest.artifacts.length})…`,
        l / t,
      ),
    );
    let text: string;
    if (artifact.encoding === "gzip" || artifact.path.endsWith(".gz")) {
      text = ungzip(new Uint8Array(buf), { to: "string" });
    } else {
      text = new TextDecoder().decode(buf);
    }
    const entries = JSON.parse(text) as GrammarEntry[];
    for (const entry of entries) {
      // Index on the headword and (if distinct) the kana display reading,
      // matching the v1 worker's lookup keys.
      map.set(entry[0], entry);
      const alt = entry[2];
      if (alt && alt !== entry[0]) map.set(alt, entry);
    }
  }
  return map;
}

async function loadTokenizer(onProgress?: LoaderProgress): Promise<TokenizerLike> {
  onProgress?.("Starting morphology engine…", 0);
  // Dynamic import so SSR never pulls kuromoji in.
  const kuromoji = (await import("kuromoji")).default;
  const builder = kuromoji.builder({ dicPath: KUROMOJI_DICT_PATH });
  const tokenizer = await new Promise<TokenizerLike>((resolve, reject) => {
    builder.build((err, t) => {
      if (err) reject(err);
      else resolve(t as TokenizerLike);
    });
  });
  onProgress?.("Starting morphology engine…", 1);
  return tokenizer;
}

export async function loadEngineResources(
  onProgress?: LoaderProgress,
): Promise<EngineResources> {
  // Dictionary, grammar and gloss index can fetch in parallel; the tokenizer
  // is sequenced after so its progress reads from a single thread of work.
  const [dictionary, grammar, glossIndex] = await Promise.all([
    loadDictionary(onProgress),
    loadGrammar(onProgress),
    loadGlossIndex(onProgress),
  ]);
  const tokenizer = await loadTokenizer(onProgress);
  return { dictionary, grammar, tokenizer, glossIndex };
}
