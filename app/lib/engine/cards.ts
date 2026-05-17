// Build TermCardData from dictionary / grammar entries.
//
// One sense (JMdict) → one numbered gloss line, with the sense's glosses joined
// by "; ". This matches the v1 vocab card render. Example sentences come from
// `e: [idx]` indexed into the global `sentences` array, capped at 3 — the
// pipeline's default examples-per-entry. Card POS pills show the first sense's
// POS tags (deduped).

import type { TermCardData } from "../../components/TermCard";
import type { ExampleSentence } from "../../components/Example";
import type {
  Dictionary,
  GrammarEntry,
  GrammarMap,
  VocabEntry,
} from "./types";
import { extractGrammarContent, findStructuredContent } from "./grammarContent";

const MAX_EXAMPLES = 3;

function collectExamples(
  entry: VocabEntry,
  sentences: Array<[string, string]>,
): ExampleSentence[] {
  if (!entry.e || entry.e.length === 0) return [];
  const out: ExampleSentence[] = [];
  for (const idx of entry.e.slice(0, MAX_EXAMPLES)) {
    const pair = sentences[idx];
    if (!pair) continue;
    out.push({ jp: pair[0], en: pair[1] });
  }
  return out;
}

function senseTags(senses: VocabEntry["s"]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of senses) {
    if (!s.misc) continue;
    for (const m of s.misc) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

// Collapse senses that share identical gloss text. JMdict frequently splits a
// single English meaning across many senses that differ only by which reading
// or register applies (e.g. 私 has thirteen "I; me" senses, one per reading
// from わたし to わっち). The misc register tags those senses carry are already
// aggregated into the card's tag chips via senseTags(), so the duplicated
// gloss rows add nothing the reader can act on. First occurrence wins, which
// preserves JMdict's primary-first ordering.
function senseGlosses(senses: VocabEntry["s"]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of senses) {
    const text = s.glosses.join("; ");
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function primaryPos(senses: VocabEntry["s"]): string[] {
  if (senses.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of senses[0].pos) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 2) break;
  }
  return out;
}

export function buildVocabCard(
  dictKey: string,
  entry: VocabEntry,
  surface: string,
  dictionary: Dictionary,
): TermCardData {
  const reading = entry.r[0];
  return {
    id: "v-" + dictKey,
    type: "vocab",
    head: dictKey,
    reading,
    surface,
    pos: primaryPos(entry.s),
    tags: senseTags(entry.s),
    glosses: senseGlosses(entry.s),
    examples: collectExamples(entry, dictionary.sentences),
  };
}

/** Look up a vocab card by dictKey; falls back through the kana→kanji index. */
export function lookupVocabCard(
  dictionary: Dictionary,
  dictKey: string,
): TermCardData | null {
  const direct = dictionary.words[dictKey];
  if (direct) return buildVocabCard(dictKey, direct, dictKey, dictionary);
  // Fall back: maybe dictKey is a kana reading. The readings index is
  // frequency-sorted by the pipeline, so the first kanji form wins.
  const kanjis = dictionary.readings[dictKey];
  if (kanjis && kanjis.length > 0) {
    const first = kanjis[0];
    const entry = dictionary.words[first];
    if (entry) return buildVocabCard(first, entry, first, dictionary);
  }
  return null;
}

export function buildGrammarCard(entry: GrammarEntry): TermCardData {
  const headword = entry[0];
  // The kana reading: prefer term-tag field [2] when it differs from the
  // headword (matches the v1 grammar card render).
  const tagReading = entry[2];
  const fieldReading = entry[1];
  let reading: string | undefined;
  if (tagReading && tagReading !== headword) reading = tagReading;
  else if (fieldReading && fieldReading !== headword) reading = fieldReading;

  const jlpt = entry[7];
  const content = findStructuredContent(entry[5]);
  const { glosses, explanation, examples } = extractGrammarContent(content);

  return {
    id: "g-" + headword,
    type: "grammar",
    head: headword,
    reading,
    pos: ["grammar"],
    tags: jlpt ? [jlpt] : undefined,
    glosses: glosses.length > 0 ? glosses : [""],
    explanation,
    examples,
  };
}

/** Look up a grammar card by its dictKey (the headword). */
export function lookupGrammarCard(
  grammar: GrammarMap,
  dictKey: string,
): TermCardData | null {
  const entry = grammar.get(dictKey);
  return entry ? buildGrammarCard(entry) : null;
}
