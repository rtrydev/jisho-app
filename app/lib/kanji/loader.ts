// Browser-only loader for the kanji + RADKFILE artifacts. Mirrors the lazy
// pattern in app/lib/handwriting/loader.ts — the radical picker sheet
// mounts the hook on first open, so this work only happens when the user
// asks for it.

import { ungzip } from "pako";
import { buildBitset, wordsForBits } from "./intersect";
import type { KanjiManifest, RadkfileManifest } from "./types";

const KANJI_URL = "/data/kanji.json.gz";
const RADKFILE_URL = "/data/radkfile.json.gz";

export type KanjiResources = {
  /** The kanji-info map keyed by character. */
  kanji: KanjiManifest["data"];
  /** Ordered class list — bitset position `i` corresponds to classes[i]. */
  classes: string[];
  /** Metadata for every radical (in stroke-count order). */
  radicals: RadkfileManifest["radicals"];
  /** Pre-built Uint32Array bitsets keyed by radical character. */
  bitsets: Map<string, Uint32Array>;
  /** Bits per bitset — equal to `classes.length`. */
  totalBits: number;
};

export type LoaderProgress = (step: string, ratio: number) => void;

async function fetchGzJson<T>(
  url: string,
  step: string,
  onProgress?: LoaderProgress,
): Promise<T> {
  onProgress?.(step, 0);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${res.status}. Run the data pipeline to ` +
        `produce kanji + radkfile artifacts (Stage 7 — needs ` +
        `data/kanjidic2.xml.gz + data/radkfile2).`,
    );
  }
  const buf = await res.arrayBuffer();
  onProgress?.(step, 0.5);
  const json = ungzip(new Uint8Array(buf), { to: "string" });
  onProgress?.(step, 1);
  return JSON.parse(json) as T;
}

let _resourcesPromise: Promise<KanjiResources> | null = null;

export function loadKanjiData(
  onProgress?: LoaderProgress,
): Promise<KanjiResources> {
  if (_resourcesPromise) return _resourcesPromise;
  _resourcesPromise = (async () => {
    const [kanjiManifest, radkfile] = await Promise.all([
      fetchGzJson<KanjiManifest>(KANJI_URL, "Loading kanji metadata…", onProgress),
      fetchGzJson<RadkfileManifest>(
        RADKFILE_URL,
        "Loading radical map…",
        onProgress,
      ),
    ]);
    // Pre-bake bitsets at load time so the picker pays zero parse cost on
    // each interaction. ~50 KB total in-memory for ~250 radicals × 6,000
    // kanji — negligible.
    const totalBits = radkfile.classes.length;
    const bitsets = new Map<string, Uint32Array>();
    for (const [rad, indices] of Object.entries(radkfile.byRadical)) {
      bitsets.set(rad, buildBitset(indices, totalBits));
    }
    void wordsForBits; // imported for downstream consumers / dev clarity
    return {
      kanji: kanjiManifest.data,
      classes: radkfile.classes,
      radicals: radkfile.radicals,
      bitsets,
      totalBits,
    };
  })();
  return _resourcesPromise;
}

export function resetKanjiData(): void {
  _resourcesPromise = null;
}
