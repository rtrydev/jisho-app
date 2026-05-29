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

/** Look up dictionary words spanning the recognised per-position candidates,
 *  and rank the hits by joint recogniser confidence × dictionary frequency.
 *
 *  Every *contiguous run* of two or more slots is tried against the
 *  dictionary, not just the full-width concatenation. Segmentation can emit
 *  one more group than the word actually has — e.g. a two-kanji compound drawn
 *  as three detected characters — and an all-or-nothing match on the full slot
 *  count would then miss the real word even when both its characters are the
 *  top-1 of adjacent slots. Scanning sub-spans recovers those.
 *
 *  Bounded combinatorial work: for S slots there are O(S²) contiguous runs,
 *  each doing ≤ `perPositionLimit ** runLength` O(1) hash lookups. With the
 *  defaults and the 2–4 slots Draw mode produces this stays in the low
 *  thousands of lookups. Returns an empty array when fewer than two slots are
 *  supplied, or when any position's top candidate sits below `minTopScore` —
 *  both signal there is nothing meaningful to suggest. */
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
  // Floor below which a slot's top candidate is treated as "the recognizer is
  // not really sure here" and word lookup is skipped. The handwriting
  // recognizer's softmax is low-magnitude — a confidently-recognized character
  // often peaks at only 0.05–0.20 (visually ambiguous kanji like 日 even
  // lower) — so this must sit well under that, or real words never surface.
  // The dictionary lookup itself is the real filter: only genuine headwords
  // match regardless of score.
  const minTopScore = options?.minTopScore ?? 0.01;
  if (slots.length < 2) return [];

  const trimmed: WordCombinationSlot[] = [];
  for (const g of slots) {
    if (g.length === 0 || g[0].score < minTopScore) return [];
    trimmed.push(g.slice(0, perPos));
  }

  // For every contiguous run of slots [start, end) of length ≥ 2, build the
  // Cartesian product (carrying a running joint score = product of softmax
  // probs) and keep any product that is a real headword. Dedupe by headword,
  // keeping the highest-scoring occurrence.
  type Combo = { chars: string; score: number };
  const best = new Map<string, WordSuggestion>();
  for (let start = 0; start < trimmed.length; start++) {
    let combos: Combo[] = [{ chars: "", score: 1 }];
    for (let end = start + 1; end <= trimmed.length; end++) {
      const next: Combo[] = [];
      for (const c of combos) {
        for (const cand of trimmed[end - 1]) {
          next.push({ chars: c.chars + cand.char, score: c.score * cand.score });
        }
      }
      combos = next;
      if (end - start < 2) continue; // single-slot spans aren't words
      for (const combo of combos) {
        const entry = resources.dictionary.words[combo.chars];
        if (!entry) continue;
        const prev = best.get(combo.chars);
        if (prev && prev.jointScore >= combo.score) continue;
        best.set(combo.chars, {
          headword: combo.chars,
          reading: entry.r[0],
          gloss: entry.s[0]?.glosses[0] ?? "",
          freq: entry.f ?? 0,
          jointScore: combo.score,
        });
      }
    }
  }

  // Rank by confidence × log(1 + freq). The confidence is length-neutralised
  // (geometric mean of the per-position probs) so a longer compound isn't
  // penalised for multiplying more sub-1 scores, and a mild length factor lets
  // a real multi-kanji word outrank a shorter substring of it at comparable
  // confidence. The log keeps a single 1000×-more-common word from dominating
  // alternatives the recogniser was much more sure about.
  const weight = (s: WordSuggestion): number => {
    const len = Math.max(1, s.headword.length);
    return Math.pow(s.jointScore, 1 / len) * Math.log1p(s.freq) * len;
  };
  const matches = [...best.values()];
  matches.sort((a, b) => weight(b) - weight(a));
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
