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
GRAMMAR_MANIFEST_OUT = OUTPUT_DIR / "grammar-manifest.json"
ATTRIBUTION_OUT = OUTPUT_DIR / "ATTRIBUTION.md"
BUILD_MANIFEST_OUT = OUTPUT_DIR / "build-manifest.json"


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
