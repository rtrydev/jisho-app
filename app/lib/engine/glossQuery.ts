// Runtime side of the EN→JP reverse-index lookup.
//
// The normalize step here MUST stay byte-for-byte aligned with
// `tools/data_pipeline/stage5b_gloss_index.py:normalize_tokens` — any drift
// silently destroys recall (queries stem differently than the index does).
// If you change one, change both.

// Stopword list mirror — must stay aligned with
// `tools/data_pipeline/config.py:GLOSS_STOPWORDS`. Modals, negations, base
// short verbs (be/have/do…), and content pronouns (this/that/it…) are
// intentionally absent: they are content for the EN→JP lookup.
const STOPWORDS = new Set<string>([
  "a", "an", "the",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "into", "onto",
  "as", "than", "then", "so", "if",
  "and", "or", "but",
  "is", "are", "was", "were", "am", "been", "being",
  "has", "had", "having",
  "does", "did", "doing",
  "etc", "esp", "lit", "eg", "ie",
]);

const MIN_TOKEN_LEN = 2;

const PAREN_RE = /[([][^)\]]*[)\]]/g;
// Anything that isn't a-z, 0-9, or apostrophe becomes whitespace. Matches the
// Python regex `[^a-z0-9']+` after the input has been lowercased.
const NONWORD_RE = /[^a-z0-9']+/g;

function stem(tok: string): string {
  if (tok.length > 4 && tok.endsWith("ing")) return tok.slice(0, -3);
  if (tok.length > 4 && tok.endsWith("ed")) return tok.slice(0, -2);
  if (tok.length > 4 && tok.endsWith("ies")) return tok.slice(0, -3) + "y";
  if (tok.length > 3 && tok.endsWith("es") && !tok.endsWith("ses")) return tok.slice(0, -2);
  if (tok.length > 3 && tok.endsWith("s") && !tok.endsWith("ss")) return tok.slice(0, -1);
  return tok;
}

/** Lowercase → strip parentheticals → split → drop stopwords/shorts → stem.
 *  Mirrors `stage5b_gloss_index.normalize_tokens`. */
export function normalizeQuery(text: string): string[] {
  if (!text) return [];
  let s = text.toLowerCase();
  s = s.replace(PAREN_RE, " ");
  s = s.replace(NONWORD_RE, " ");
  const out: string[] = [];
  for (const raw of s.split(/\s+/)) {
    let tok = raw.replace(/^'+|'+$/g, "");
    if (tok.endsWith("'s")) tok = tok.slice(0, -2);
    if (!tok) continue;
    if (STOPWORDS.has(tok)) continue;
    if (tok.length < MIN_TOKEN_LEN) continue;
    if (/^\d+$/.test(tok)) continue;
    const stemmed = stem(tok);
    if (!stemmed || STOPWORDS.has(stemmed)) continue;
    out.push(stemmed);
  }
  return out;
}
