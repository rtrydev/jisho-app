// Public engine boundary. Consumers MUST go through this module — never reach
// into `app/lib/engine/` internals. The provider layer wraps `analyze` and
// `loadEngineResources` behind a single React context (`useAnalyzer`).
//
// The engine itself is byte-for-byte the v1 logic — kuromoji morphology, a
// 6-token grammar window, kana→kanji fallback, and an IGNORED_POS dedup
// filter. The pipeline that produces dictionary.json.gz + grammar.json.gz is
// the only thing that changed.

import type { TermCardData } from "../components/TermCard";
import { analyze as engineAnalyze, IGNORED_POS } from "./engine/analyze";
import {
  lookupGrammarCard,
  lookupVocabCard,
} from "./engine/cards";
import { lookupEnglish } from "./engine/englishLookup";
import type { EngineResources } from "./engine/types";
import { detectLanguage, type Direction } from "./lang";

export type AnalysisStatus =
  | { kind: "idle" }
  | { kind: "loading"; step: string; progress: number }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export type AnalysisResult = {
  text: string;
  /** Detected input language. Both directions produce a breakdown:
   *  `"ja"` segments via the morphological engine, `"en"` segments via
   *  greedy longest-match against the reverse gloss index. */
  direction: Direction;
  tokens: import("../components/BreakdownChip").BreakdownToken[];
  cardItems: TermCardData[];
  english?: string;
  source?: string;
};

export const EMPTY_RESULT: AnalysisResult = {
  text: "",
  direction: "ja",
  tokens: [],
  cardItems: [],
};

export type { EngineResources };
export type { Direction };
export { IGNORED_POS };
export { detectLanguage };

export function analyze(resources: EngineResources, text: string): AnalysisResult {
  const trimmed = text.trim();
  if (!trimmed) return EMPTY_RESULT;
  const direction = detectLanguage(trimmed);
  if (direction === "en") {
    const { tokens, cards } = lookupEnglish(resources, trimmed);
    return {
      text: trimmed,
      direction: "en",
      tokens,
      cardItems: cards,
    };
  }
  const inner = engineAnalyze(resources, text);
  return { ...inner, direction: "ja" };
}

/** Re-resolve a stored favorite into a renderable TermCard against live
 *  resources. Tries `dictKey` first; if that misses (older stub-built keys
 *  like "watashi", entries renamed between dictionary builds), falls back to
 *  the saved `surface` form, which is the kanji/kana the user actually saw.
 *  Returns null only when neither key resolves — favorites are *references*,
 *  not snapshots, so a swapped-out dictionary can legally orphan one. */
export function getDictionaryEntry(
  resources: EngineResources,
  type: "vocab" | "grammar",
  dictKey: string,
  surface?: string,
): TermCardData | null {
  if (type === "vocab") {
    const direct = lookupVocabCard(resources.dictionary, dictKey);
    if (direct) return direct;
    if (surface && surface !== dictKey) {
      return lookupVocabCard(resources.dictionary, surface);
    }
    return null;
  }
  const direct = lookupGrammarCard(resources.grammar, dictKey);
  if (direct) return direct;
  if (surface && surface !== dictKey) {
    return lookupGrammarCard(resources.grammar, surface);
  }
  return null;
}

/** Stable dictKey for a card. The id format is `<v|g>-<dictKey>` so we can
 *  strip the two-char prefix unambiguously. */
export function dictKeyOf(card: TermCardData): string {
  return card.id.slice(2);
}

/** One example word containing a given kanji, distilled for the KanjiCard
 *  "In words" section. Independent of TermCardData — those are heavier and
 *  the kanji detail view only needs a one-line preview per word. */
export type KanjiWordExample = {
  headword: string;
  reading?: string;
  gloss: string;
  freq: number;
};

/** A real dictionary match for a kanji combination, used by the handwriting
 *  Draw mode to surface "you might be writing this word" hints. */
export type WordSuggestion = {
  headword: string;
  reading?: string;
  gloss: string;
  freq: number;
  /** Product of per-position recognizer softmax probabilities. Used in
   *  ranking; not displayed. */
  jointScore: number;
};

/** One position's recognizer output, accepted as a permissive shape so the
 *  caller doesn't have to import the handwriting `Candidate` type — any
 *  `{ char, score }` array works. Scores must already be normalised to [0, 1]. */
export type WordCombinationSlot = ReadonlyArray<{
  char: string;
  score: number;
}>;

/** Cross every per-position candidate with every other, look up each
 *  combination in the dictionary, and rank the hits by joint recogniser
 *  confidence × dictionary frequency.
 *
 *  Strictly bounded combinatorial work: `perPositionLimit ** slots.length`
 *  hash lookups in the worst case (≤ 125 with defaults), each O(1). Returns
 *  an empty array when fewer than two slots are supplied, or when any
 *  position's top candidate sits below `minTopScore` — both signal that
 *  there is nothing meaningful to suggest. */
export function findWordCombinations(
  resources: EngineResources,
  slots: ReadonlyArray<WordCombinationSlot>,
  options?: {
    perPositionLimit?: number;
    resultLimit?: number;
    minTopScore?: number;
  },
): WordSuggestion[] {
  const perPos = options?.perPositionLimit ?? 5;
  const resultLimit = options?.resultLimit ?? 6;
  const minTopScore = options?.minTopScore ?? 0.05;
  if (slots.length < 2) return [];

  const trimmed: WordCombinationSlot[] = [];
  for (const g of slots) {
    if (g.length === 0 || g[0].score < minTopScore) return [];
    trimmed.push(g.slice(0, perPos));
  }

  // Cartesian product carrying a running joint score (product of softmax
  // probs). We keep all combinations and filter against the dictionary in
  // one sweep at the end rather than mutating the working set mid-product.
  type Combo = { chars: string; score: number };
  let combos: Combo[] = [{ chars: "", score: 1 }];
  for (const slot of trimmed) {
    const next: Combo[] = [];
    for (const c of combos) {
      for (const cand of slot) {
        next.push({
          chars: c.chars + cand.char,
          score: c.score * cand.score,
        });
      }
    }
    combos = next;
  }

  const matches: WordSuggestion[] = [];
  const seen = new Set<string>();
  for (const combo of combos) {
    if (seen.has(combo.chars)) continue;
    const entry = resources.dictionary.words[combo.chars];
    if (!entry) continue;
    seen.add(combo.chars);
    matches.push({
      headword: combo.chars,
      reading: entry.r[0],
      gloss: entry.s[0]?.glosses[0] ?? "",
      freq: entry.f ?? 0,
      jointScore: combo.score,
    });
  }

  // Rank by joint confidence × log(1 + freq). The log keeps a single
  // 1000×-more-common word from dominating over slightly-less-frequent
  // alternatives the recogniser was much more sure about.
  matches.sort((a, b) => {
    const aw = a.jointScore * Math.log1p(a.freq);
    const bw = b.jointScore * Math.log1p(b.freq);
    return bw - aw;
  });
  return matches.slice(0, resultLimit);
}

/** Find dictionary entries whose headword contains the given kanji,
 *  ordered by descending frequency. Pure scan — runs in ~30–80ms on a
 *  ~217k-key dictionary, called once when a KanjiCard mounts. */
export function findWordsContainingKanji(
  resources: EngineResources,
  char: string,
  limit = 8,
): KanjiWordExample[] {
  if (!char) return [];
  const matches: Array<{ headword: string; freq: number; entry: import("./engine/types").VocabEntry }> = [];
  for (const [headword, entry] of Object.entries(resources.dictionary.words)) {
    if (!headword.includes(char)) continue;
    matches.push({ headword, freq: entry.f ?? 0, entry });
  }
  // Sort by frequency desc, then headword length asc (shorter compounds
  // tend to be more recognizable for the at-a-glance preview).
  matches.sort((a, b) => {
    if (b.freq !== a.freq) return b.freq - a.freq;
    return a.headword.length - b.headword.length;
  });
  return matches.slice(0, limit).map(({ headword, freq, entry }) => ({
    headword,
    reading: entry.r[0],
    gloss: entry.s[0]?.glosses[0] ?? "",
    freq,
  }));
}
