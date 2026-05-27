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
