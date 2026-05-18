// EN → JP sentence breakdown driven by the reverse gloss index.
//
// Mirror of the JP analyzer in spirit: the input is segmented into chips, a
// greedy longest-match window walks the word stream, and each matched span
// resolves to a TermCardData (vocab or grammar). The "longest match wins"
// rule is what lets us treat multi-word expressions as units — "give up
// running" segments as [give up][running] rather than [give][up][running],
// "in spite of" segments as a single grammar chip, and so on.
//
// The matching is dictionary-driven, not parser-driven: a window is a chip
// iff its normalized form is actually a key in the reverse index. So the
// segmentation reflects what the dictionaries say is a unit, not what an
// English POS tagger would say.
//
// Cards built here are *inverted* compared to the JP→EN path: the head is
// the English query word/phrase, and the body lists JP translation
// candidates pulled from the top of the matched posting list. Multiple
// chips that share a normalized form share a single card.
//
// Normalization is `normalizeQuery` from glossQuery.ts, which is the runtime
// twin of `tools/data_pipeline/stage5b_gloss_index.py:normalize_tokens`.

import type {
  BreakdownToken,
  ChipKind,
} from "../../components/BreakdownChip";
import type { CandidateRef, TermCardData } from "../../components/TermCard";
import { buildGrammarCard } from "./cards";
import { normalizeQuery } from "./glossQuery";
import { extractGrammarContent, findStructuredContent } from "./grammarContent";
import type {
  EngineResources,
  GlossIndexSection,
  GlossPosting,
} from "./types";

// Max number of surface words to include in a single sliding window. Has to
// be at least PHRASE_MAX_LEN + a few stopwords' worth of slack, since
// stopwords ("in spite of") sit *between* normalized tokens. 6 covers
// "in spite of all that" (5 surface → 1 normalized) and "as soon as
// possible" (4 surface → 2 normalized) comfortably.
const MAX_WINDOW = 6;
// Mirrors the build-time `gloss_max_phrase_len`. Phrase keys longer than
// this aren't in the index, so don't bother joining longer normalized lists.
const PHRASE_MAX_LEN = 4;
// How many JP candidates to surface per English chip. The user can pick
// from this list; more than a handful crowds the card and ranks beyond ~8
// are usually irrelevant anyway since the posting list is capped at 200
// at build time and sorted by canonicity × frequency.
const CANDIDATES_PER_CARD = 8;

const WORD_RE = /[A-Za-z][A-Za-z'\-]*|[0-9]+/g;
const PUNCT_RE = /[^\sA-Za-z0-9]+/;

type MatchKind = "vocab" | "grammar";

// Per-resources cache of extracted grammar meaning glosses. The Yomitan
// structured-content parse isn't free; we only run it for entries we've
// actually matched against, and the WeakMap lets stale resources get
// collected after a refresh.
const grammarGlossesCache = new WeakMap<EngineResources, Map<string, string[]>>();

function getEntryGlosses(
  resources: EngineResources,
  kind: MatchKind,
  head: string,
): string[] {
  if (kind === "vocab") {
    const entry = resources.dictionary.words[head];
    if (!entry) return [];
    const out: string[] = [];
    for (const sense of entry.s) {
      for (const g of sense.glosses) out.push(g);
    }
    return out;
  }
  let cache = grammarGlossesCache.get(resources);
  if (!cache) {
    cache = new Map();
    grammarGlossesCache.set(resources, cache);
  }
  const hit = cache.get(head);
  if (hit !== undefined) return hit;
  const entry = resources.grammar.get(head);
  if (!entry) {
    cache.set(head, []);
    return [];
  }
  const content = extractGrammarContent(findStructuredContent(entry[5]));
  cache.set(head, content.glosses);
  return content.glosses;
}

function glossesContain(glosses: string[], surface: string): boolean {
  const cleaned = surface.toLowerCase().trim();
  if (!cleaned) return false;
  for (const g of glosses) {
    if (g.toLowerCase().includes(cleaned)) return true;
  }
  return false;
}

type Word = { text: string; start: number; end: number };

function extractWords(input: string): Word[] {
  const out: Word[] = [];
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(input)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

type PostingHit = {
  kind: MatchKind;
  /** Full posting list for the matched key, pre-sorted at build time. */
  postings: GlossPosting[];
  /** Number of normalized tokens that matched. Bigger = more specific. */
  matchTokens: number;
};

function lookupKey(
  section: GlossIndexSection,
  normalized: string[],
  kind: MatchKind,
): PostingHit | null {
  if (normalized.length === 0) return null;
  if (normalized.length === 1) {
    const u = section.u[normalized[0]];
    return u && u.length > 0 ? { kind, postings: u, matchTokens: 1 } : null;
  }
  if (normalized.length > PHRASE_MAX_LEN) return null;
  const key = normalized.join(" ");
  const p = section.p[key];
  return p && p.length > 0 ? { kind, postings: p, matchTokens: normalized.length } : null;
}

function pickBest(a: PostingHit | null, b: PostingHit | null): PostingHit | null {
  if (!a) return b;
  if (!b) return a;
  // More specific (longer phrase) matches win regardless of kind.
  if (a.matchTokens !== b.matchTokens) return a.matchTokens > b.matchTokens ? a : b;
  // Same specificity: grammar wins ties — grammar is rarer and the match is
  // therefore more informative when both kinds agree on the span.
  if (a.kind !== b.kind) return a.kind === "grammar" ? a : b;
  // Same specificity and kind: whichever has the higher top-posting score.
  return a.postings[0][2] >= b.postings[0][2] ? a : b;
}

type WindowMatch = {
  /** First and last word indices the chip covers (inclusive), AFTER trimming
   *  leading/trailing words that don't contribute to the normalized form. */
  firstWord: number;
  lastWord: number;
  /** Stable key derived from the normalized form — used as the card id so
   *  multiple chips with the same normalized form (e.g., "this" appearing
   *  twice in a sentence) share a single inverted card. */
  normalizedKey: string;
  hit: PostingHit;
};

function findMatch(
  input: string,
  words: Word[],
  start: number,
  resources: EngineResources,
): WindowMatch | null {
  const { glossIndex } = resources;
  const maxLen = Math.min(MAX_WINDOW, words.length - start);
  // Try longest windows first — greedy longest-match.
  for (let len = maxLen; len >= 1; len--) {
    const slice = input.slice(words[start].start, words[start + len - 1].end);
    const normalized = normalizeQuery(slice);
    if (normalized.length === 0) continue;
    const vocabHit = lookupKey(glossIndex.vocab, normalized, "vocab");
    const grammarHit = lookupKey(glossIndex.grammar, normalized, "grammar");
    const best = pickBest(vocabHit, grammarHit);
    if (!best) continue;
    // Trim leading/trailing words whose individual normalization is empty.
    const windowStart = start;
    const windowEnd = start + len - 1;
    let firstWord = windowStart;
    let lastWord = windowEnd;
    while (firstWord <= lastWord && normalizeQuery(words[firstWord].text).length === 0) {
      firstWord += 1;
    }
    while (lastWord >= firstWord && normalizeQuery(words[lastWord].text).length === 0) {
      lastWord -= 1;
    }
    if (firstWord > lastWord) continue;
    // Boundary extension is dictionary-driven: extend outward one word at a
    // time as long as the broader surface remains a verbatim substring of
    // some gloss of the matched entry. See class-doc comment above.
    const matchGlosses = getEntryGlosses(resources, best.kind, best.postings[0][0]);
    if (matchGlosses.length > 0) {
      let lo = firstWord;
      while (lo > windowStart) {
        const candidate = input.slice(words[lo - 1].start, words[lastWord].end);
        if (!glossesContain(matchGlosses, candidate)) break;
        lo -= 1;
      }
      firstWord = lo;
      let hi = lastWord;
      while (hi < windowEnd) {
        const candidate = input.slice(words[firstWord].start, words[hi + 1].end);
        if (!glossesContain(matchGlosses, candidate)) break;
        hi += 1;
      }
      lastWord = hi;
    }
    return {
      firstWord,
      lastWord,
      normalizedKey: normalized.join(" "),
      hit: best,
    };
  }
  return null;
}

function maybeEmitPunct(
  input: string,
  fromOffset: number,
  toOffset: number,
  out: BreakdownToken[],
): void {
  if (fromOffset >= toOffset) return;
  const between = input.slice(fromOffset, toOffset);
  if (!PUNCT_RE.test(between)) return;
  const visible = between.replace(/\s+/g, " ").trim();
  if (!visible) return;
  out.push({ surface: visible, pos: "punct", kind: "punct", script: "en" });
}

function buildCandidate(
  resources: EngineResources,
  kind: MatchKind,
  posting: GlossPosting,
): CandidateRef | null {
  const [head, senseIdx] = posting;
  if (kind === "vocab") {
    const entry = resources.dictionary.words[head];
    if (!entry) return null;
    const sense = entry.s[senseIdx];
    if (!sense) return null;
    return {
      head,
      reading: entry.r[0],
      kind: "vocab",
      // Limit to the first couple of POS tags — the card body otherwise
      // crowds with vt/vi/n/adj-* permutations.
      pos: sense.pos.slice(0, 2),
      disambig: sense.glosses.join("; "),
    };
  }
  const entry = resources.grammar.get(head);
  if (!entry) return null;
  const card = buildGrammarCard(entry);
  return {
    head,
    reading: card.reading,
    kind: "grammar",
    pos: card.pos,
    disambig: card.glosses[0] || undefined,
  };
}

function buildEnglishCard(
  resources: EngineResources,
  surface: string,
  normalizedKey: string,
  kind: MatchKind,
  postings: GlossPosting[],
): TermCardData | null {
  const candidates: CandidateRef[] = [];
  const seen = new Set<string>();
  for (const posting of postings) {
    if (candidates.length >= CANDIDATES_PER_CARD) break;
    // Dedupe on JP headword — JMdict often produces multiple posting rows
    // (different senses) for the same headword; the user only needs to see
    // the entry once in the candidate list.
    if (seen.has(posting[0])) continue;
    const cand = buildCandidate(resources, kind, posting);
    if (!cand) continue;
    seen.add(posting[0]);
    candidates.push(cand);
  }
  if (candidates.length === 0) return null;
  return {
    id: "en-" + normalizedKey,
    type: kind,
    head: surface,
    pos: [],
    glosses: [],
    candidates,
  };
}

export type EnglishLookupResult = {
  tokens: BreakdownToken[];
  cards: TermCardData[];
};

export function lookupEnglish(
  resources: EngineResources,
  query: string,
): EnglishLookupResult {
  const words = extractWords(query);
  if (words.length === 0) return { tokens: [], cards: [] };

  const tokens: BreakdownToken[] = [];
  const cardsById = new Map<string, TermCardData>();
  let lastEnd = 0;
  let i = 0;

  const emitUnmatched = (wordIdx: number): void => {
    const w = words[wordIdx];
    maybeEmitPunct(query, lastEnd, w.start, tokens);
    tokens.push({
      surface: w.text,
      pos: "—",
      kind: "particle",
      script: "en",
    });
    lastEnd = w.end;
  };

  while (i < words.length) {
    const match = findMatch(query, words, i, resources);
    if (match) {
      for (let j = i; j < match.firstWord; j++) emitUnmatched(j);

      const firstW = words[match.firstWord];
      const lastW = words[match.lastWord];
      maybeEmitPunct(query, lastEnd, firstW.start, tokens);
      const surface = query.slice(firstW.start, lastW.end);
      const cardId = "en-" + match.normalizedKey;
      let card = cardsById.get(cardId) ?? null;
      if (!card) {
        card = buildEnglishCard(
          resources,
          surface,
          match.normalizedKey,
          match.hit.kind,
          match.hit.postings,
        );
        if (card) cardsById.set(cardId, card);
      }
      if (card) {
        const kind: ChipKind = match.hit.kind;
        // Chip's "pos" slot shows the top JP candidate's headword as an
        // at-a-glance hint; the full candidate list lives on the card.
        const topJp = card.candidates && card.candidates[0]
          ? card.candidates[0].head
          : "";
        tokens.push({
          surface,
          pos: topJp,
          cardId,
          kind,
          script: "en",
        });
      } else {
        tokens.push({
          surface,
          pos: "?",
          kind: "particle",
          script: "en",
        });
      }
      lastEnd = lastW.end;
      i = match.lastWord + 1;
      continue;
    }

    emitUnmatched(i);
    i += 1;
  }

  maybeEmitPunct(query, lastEnd, query.length, tokens);

  return {
    tokens,
    cards: Array.from(cardsById.values()),
  };
}
