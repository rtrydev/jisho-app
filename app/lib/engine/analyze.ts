// Engine analysis pipeline. Pure: given pre-loaded resources + text, produces
// the BreakdownToken[] and TermCardData[] the UI consumes. Mirrors the v1
// worker logic byte-for-byte in spirit:
//
//   1. Tokenize the input via Kuromoji + IPADIC.
//   2. Walk the token stream. At each position, try a 6-token grammar window —
//      longest contiguous match in the grammar map wins.
//   3. Otherwise treat the token as vocab: look up `basic_form` directly in
//      `words`; fall back through the kana→kanji `readings` index (first key
//      wins — the build pipeline pre-sorts kanji forms by frequency).
//   4. Dedupe to a card list. Vocab whose Japanese POS is in IGNORED_POS
//      (helpers, particles, symbols, prefixes, fillers) is excluded from cards
//      but still appears as a chip.

import type { BreakdownToken, ChipKind } from "../../components/BreakdownChip";
import type { TermCardData } from "../../components/TermCard";
import type {
  EngineResources,
  GrammarEntry,
} from "./types";
import { buildGrammarCard, buildVocabCard } from "./cards";

export const IGNORED_POS = new Set([
  "助動詞",
  "助詞",
  "記号",
  "接頭詞",
  "フィラー",
]);

const GRAMMAR_WINDOW = 6;

export type AnalysisResult = {
  text: string;
  tokens: BreakdownToken[];
  cardItems: TermCardData[];
  english?: string;
  source?: string;
};

const EMPTY: AnalysisResult = { text: "", tokens: [], cardItems: [] };

/** Map a kuromoji Japanese POS to a chip kind for visual classification.
 *  Vocab chips that resolve to a card carry kind="vocab" instead. */
function chipKindFromPos(pos: string): ChipKind {
  if (pos === "記号") return "punct";
  if (pos === "助詞") return "particle";
  if (pos === "助動詞") return "particle";
  if (pos === "接頭詞") return "particle";
  if (pos === "フィラー") return "particle";
  return "vocab";
}

/** Katakana → hiragana. Kuromoji's IPADIC `reading` field is katakana; the
 *  breakdown chips and term card readings use hiragana throughout. */
function kataToHira(s: string | undefined): string | undefined {
  if (!s) return undefined;
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x30a1 && code <= 0x30f6) out += String.fromCodePoint(code - 0x60);
    else out += ch;
  }
  return out;
}

type RawAnalysisToken =
  | {
      kind: "grammar";
      surface: string;
      dictKey: string;
      grammarData: GrammarEntry;
    }
  | {
      kind: "vocab";
      surface: string;
      baseForm: string;
      pos: string;
      reading?: string;
      vocabData: import("./types").VocabEntry | null;
      dictKey: string | null;
    };

function classifyTokens(
  resources: EngineResources,
  text: string,
): RawAnalysisToken[] {
  const { dictionary, grammar, tokenizer } = resources;
  const tokens = tokenizer.tokenize(text);
  const out: RawAnalysisToken[] = [];
  let i = 0;
  while (i < tokens.length) {
    let match: { count: number; entry: GrammarEntry; surface: string } | null =
      null;
    let composed = "";
    for (let span = 0; span < GRAMMAR_WINDOW && i + span < tokens.length; span++) {
      composed += tokens[i + span].surface_form;
      const entry = grammar.get(composed);
      if (entry) match = { count: span + 1, entry, surface: composed };
    }
    if (match) {
      out.push({
        kind: "grammar",
        surface: match.surface,
        // dictKey is the entry's headword (entry[0]) so the breakdown chip's
        // cardId agrees with the buildGrammarCard output even when the match
        // landed on the alternate-key slot (e.g. "でいた" → "～ていた").
        dictKey: match.entry[0],
        grammarData: match.entry,
      });
      i += match.count;
      continue;
    }
    const tok = tokens[i];
    const surface = tok.surface_form;
    const base = !tok.basic_form || tok.basic_form === "*" ? surface : tok.basic_form;
    let vocab: import("./types").VocabEntry | null = null;
    let dictKey: string | null = null;
    if (dictionary.words[base]) {
      vocab = dictionary.words[base];
      dictKey = base;
    } else {
      const kanjis = dictionary.readings[base];
      if (kanjis && kanjis.length > 0) {
        const first = kanjis[0];
        const entry = dictionary.words[first];
        if (entry) {
          vocab = entry;
          dictKey = first;
        }
      }
    }
    out.push({
      kind: "vocab",
      surface,
      baseForm: base,
      pos: tok.pos,
      reading: kataToHira(tok.reading),
      vocabData: vocab,
      dictKey,
    });
    i++;
  }
  return out;
}

function readingForGrammar(entry: GrammarEntry): string | undefined {
  const tagReading = entry[2];
  const fieldReading = entry[1];
  if (tagReading && tagReading !== entry[0]) return tagReading;
  if (fieldReading && fieldReading !== entry[0]) return fieldReading;
  return undefined;
}

export function analyze(
  resources: EngineResources,
  text: string,
): AnalysisResult {
  const trimmed = text.trim();
  if (!trimmed) return { ...EMPTY, text: "" };

  const raw = classifyTokens(resources, trimmed);

  const breakdown: BreakdownToken[] = raw.map((r) => {
    if (r.kind === "grammar") {
      return {
        surface: r.surface,
        reading: readingForGrammar(r.grammarData),
        pos: "grammar",
        cardId: "g-" + r.dictKey,
        kind: "grammar",
      };
    }
    const isCardable =
      !!r.dictKey && !!r.vocabData && !IGNORED_POS.has(r.pos);
    return {
      surface: r.surface,
      reading: r.reading,
      pos: r.pos,
      cardId: isCardable ? "v-" + (r.dictKey as string) : null,
      kind: isCardable ? "vocab" : chipKindFromPos(r.pos),
    };
  });

  const seen = new Set<string>();
  const cardItems: TermCardData[] = [];
  for (const r of raw) {
    if (r.kind === "grammar") {
      const id = "G:" + r.dictKey;
      if (seen.has(id)) continue;
      seen.add(id);
      cardItems.push(buildGrammarCard(r.grammarData));
    } else {
      if (!r.vocabData || !r.dictKey) continue;
      if (IGNORED_POS.has(r.pos)) continue;
      const id = "V:" + r.dictKey;
      if (seen.has(id)) continue;
      seen.add(id);
      cardItems.push(
        buildVocabCard(r.dictKey, r.vocabData, r.surface, resources.dictionary),
      );
    }
  }

  return { text: trimmed, tokens: breakdown, cardItems };
}
