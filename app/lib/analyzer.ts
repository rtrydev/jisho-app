// Engine boundary. The real Kuromoji + IPADIC pipeline (preserved byte-for-byte
// from v1) plugs in here; until that integration lands, this stub recognises the
// pre-baked Sōseki sample and otherwise returns an empty result.
//
// Consumers MUST go through `useAnalyzer` — never reach into engine internals.

import type { BreakdownToken } from "../components/BreakdownChip";
import type { TermCardData } from "../components/TermCard";
import {
  sentence as demoSentence,
  english as demoEnglish,
  source as demoSource,
  tokens as demoTokens,
  cards as demoCards,
} from "./demoData";

export type AnalysisStatus =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export type AnalysisResult = {
  text: string;
  tokens: BreakdownToken[];
  cardItems: TermCardData[];
  english?: string;
  source?: string;
};

const EMPTY: AnalysisResult = { text: "", tokens: [], cardItems: [] };

function normalize(s: string): string {
  return s.replace(/\s+/g, "").trim();
}

export function isEngineReady(): boolean {
  return true; // stub: always "ready"
}

export function analyze(text: string): AnalysisResult {
  const trimmed = text.trim();
  if (!trimmed) return { ...EMPTY, text: "" };

  if (normalize(trimmed) === normalize(demoSentence)) {
    return {
      text: trimmed,
      tokens: demoTokens,
      cardItems: demoCards,
      english: demoEnglish,
      source: demoSource,
    };
  }

  // Unknown text: surface the input as a single chip so the UI still composes.
  // A future Kuromoji integration replaces this branch with real tokenisation.
  const tokens: BreakdownToken[] = Array.from(trimmed).map((ch) => ({
    surface: ch,
    pos: /[぀-ヿ]/.test(ch)
      ? "kana"
      : /[一-鿿]/.test(ch)
        ? "kanji"
        : "punct",
  }));
  return { text: trimmed, tokens, cardItems: [] };
}

export function getDictionaryEntry(
  type: "vocab" | "grammar",
  dictKey: string,
): TermCardData | null {
  const prefix = type === "vocab" ? "v-" : "g-";
  return demoCards.find((c) => c.type === type && c.id === prefix + dictKey) ?? null;
}

/** Stable dictKey for a card. The real engine should produce dictKey for each
 *  unified token; here we strip the "v-"/"g-" demo prefix. */
export function dictKeyOf(card: TermCardData): string {
  return card.id.replace(/^[vg]-/, "");
}
