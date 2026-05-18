"""Pipeline configuration.

All policy knobs live here — vocabulary filtering, examples-per-entry caps,
POS normalization, gzip level, and the ``grammar_metadata`` fallback used when
the Yomitan ZIP has no ``index.json``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
PUBLIC_DIR = REPO_ROOT / "public"
OUTPUT_DIR = PUBLIC_DIR / "data"
WORK_DIR = REPO_ROOT / ".pipeline-work"

JMDICT_PATH = DATA_DIR / "JMdict_e.gz"
SENTENCES_PATH = DATA_DIR / "sentence_pairs.tsv"
GRAMMAR_ZIP_PATH = DATA_DIR / "grammar.zip"

DICTIONARY_OUT = OUTPUT_DIR / "dictionary.json.gz"
GRAMMAR_OUT = OUTPUT_DIR / "grammar.json.gz"
GLOSS_INDEX_OUT = OUTPUT_DIR / "gloss-index.json.gz"
GRAMMAR_MANIFEST_OUT = OUTPUT_DIR / "grammar-manifest.json"
ATTRIBUTION_OUT = OUTPUT_DIR / "ATTRIBUTION.md"
BUILD_MANIFEST_OUT = OUTPUT_DIR / "build-manifest.json"


# English stopwords dropped during gloss tokenization. Kept small and
# conservative — JMdict glosses are short and content-rich, so over-pruning
# hurts recall.
#
# Intentionally retained as content (NOT stopwords):
#   - Modals (will/would/should/could/may/might/must) and negations (not/no)
#     — they're the meaning of grammar entries like ない方がいい, べき,
#     必要がある, ～てはいけない.
#   - Base-form short verbs (be, have, do, go, come, make, take, give, get,
#     see, know, say, think) — JMdict universally uses them as the head of
#     verb glosses ("to do", "to have"), so a query for "do" expects する;
#     filtering them out leaves the base form unsearchable.
#   - Content pronouns (this, that, these, those, it, its) — users querying
#     "this" expect これ, "that" expect それ. Their JMdict posting lists are
#     long but the per-key cap keeps the index bounded.
#
# "to" stays a stopword because JMdict universally infinitivizes verb glosses
# ("to read", "to give up"); keeping it would double every verb's posting
# list and inflate phrase keys without changing what the user can find.
GLOSS_STOPWORDS: frozenset[str] = frozenset({
    "a", "an", "the",
    "to", "of", "in", "on", "at", "by", "for", "with", "from", "into", "onto",
    "as", "than", "then", "so", "if",
    "and", "or", "but",
    # Inflected forms of be/have/do — base forms are content. Inflected
    # auxiliaries here function as tense/aspect markers, not lookup terms.
    "is", "are", "was", "were", "am", "been", "being",
    "has", "had", "having",
    "does", "did", "doing",
    "etc", "esp", "lit", "eg", "ie",
})


@dataclass(frozen=True)
class Policy:
    # Vocabulary
    keep_all_entries: bool = True
    pos_policy: str = "short"  # "short" = JMdict entity names (e.g. "n", "v5r")

    # Sentences
    examples_per_entry: int = 3
    best_sentence_rule: str = "shortest"  # shortest adequate ja text

    # Compression
    gzip_level: int = 9

    # Validation
    validation_sample_size: int = 200

    # Bounds (catches truncated upstream snapshots)
    min_word_entries: int = 150_000
    max_word_entries: int = 300_000
    # Bounds apply to the *referenced* sentence count after per-entry capping;
    # a truncated TSV is also caught upstream at Stage 2's tokenization pass.
    min_sentence_pairs: int = 20_000
    max_sentence_pairs: int = 500_000
    min_grammar_entries: int = 500
    max_grammar_entries: int = 5_000

    # Gloss reverse-index policy (Stage 5b).
    gloss_min_token_len: int = 2
    gloss_max_postings_per_key: int = 200
    # Max n-gram length emitted under the per-section ``p`` map. 4 covers the
    # common multi-word JMdict and grammar glosses ("give up smoking", "as
    # soon as possible") without exploding the keyspace; longer matches at
    # query time fall back to overlapping shorter phrases.
    gloss_max_phrase_len: int = 4
    # Sanity bounds for the assembled index, applied per (kind, section).
    min_gloss_vocab_unigram_keys: int = 5_000
    max_gloss_vocab_unigram_keys: int = 200_000
    min_gloss_vocab_phrase_keys: int = 5_000
    max_gloss_vocab_phrase_keys: int = 2_500_000
    min_gloss_grammar_unigram_keys: int = 50
    max_gloss_grammar_unigram_keys: int = 50_000
    # Grammar bank is ~1k entries with short glosses; phrase keys can still
    # rise into the low tens of thousands once 3- and 4-grams are emitted.
    min_gloss_grammar_phrase_keys: int = 50
    max_gloss_grammar_phrase_keys: int = 100_000
    max_gloss_index_bytes_gz: int = 24 * 1024 * 1024


@dataclass(frozen=True)
class GrammarMetadata:
    """Fields normally read from a Yomitan ``index.json``.

    The current ``data/grammar.zip`` has no ``index.json`` — these defaults
    are pinned against the archive checksum (recorded at Stage 0).
    """

    title: str = "v1 jisho-app grammar bank"
    revision: str = "v1-archive-recovery"
    format: int = 3
    author: str = "unknown (recovered from archive/jisho_old.zip)"
    attribution: str = "v1 jisho-app grammar bank"
    license: str = "unspecified"


POLICY = Policy()
GRAMMAR_METADATA = GrammarMetadata()
