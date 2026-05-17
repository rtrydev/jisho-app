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
import type { EngineResources } from "./engine/types";

export type AnalysisStatus =
  | { kind: "idle" }
  | { kind: "loading"; step: string; progress: number }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export type AnalysisResult = {
  text: string;
  tokens: import("../components/BreakdownChip").BreakdownToken[];
  cardItems: TermCardData[];
  english?: string;
  source?: string;
};

export const EMPTY_RESULT: AnalysisResult = {
  text: "",
  tokens: [],
  cardItems: [],
};

export type { EngineResources };
export { IGNORED_POS };

export function analyze(resources: EngineResources, text: string): AnalysisResult {
  return engineAnalyze(resources, text);
}

/** Re-resolve a stored favorite into a renderable TermCard against live
 *  resources. Returns null if the resources don't have the entry — favorites
 *  are *references*, not snapshots, so a swapped-out grammar bank can legally
 *  leave a favorite orphaned. */
export function getDictionaryEntry(
  resources: EngineResources,
  type: "vocab" | "grammar",
  dictKey: string,
): TermCardData | null {
  if (type === "vocab") return lookupVocabCard(resources.dictionary, dictKey);
  return lookupGrammarCard(resources.grammar, dictKey);
}

/** Stable dictKey for a card. The id format is `<v|g>-<dictKey>` so we can
 *  strip the two-char prefix unambiguously. */
export function dictKeyOf(card: TermCardData): string {
  return card.id.slice(2);
}
