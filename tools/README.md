# `tools/` — data pipeline

Python implementation of the
[JishoParser data pipeline](../docs/data-pipeline-spec.md). The pipeline
consumes the operator-supplied snapshots in [`../data/`](../data/) and writes
the app's static-asset bundle to [`../public/data/`](../public/data/).

## Run it

```bash
python -m venv venv            # if not already created
source venv/bin/activate
pip install -r tools/requirements.txt
python -m tools.data_pipeline
```

The driver prints stage timings to stderr. Outputs:

| File | What it is |
|---|---|
| `public/data/dictionary.json.gz` | Gzipped `{meta, words, readings, sentences}` blob — the v1 schema, preserved as a drop-in. |
| `public/data/grammar.json.gz` | Single merged grammar artifact (Yomitan v3 entries concatenated). |
| `public/data/grammar-manifest.json` | Loader manifest: artifact path(s) + source metadata. v2's only grammar discovery surface. |
| `public/data/gloss-index.json.gz` | Reverse English-gloss index for the EN→JP lookup path. Two sections (vocab, grammar), each with unigram and 2..4-gram phrase posting maps. Postings carry a canonicity-bucket-encoded score so the runtime can rank without re-reading the entry. |
| `public/data/ATTRIBUTION.md` | Per-source license + checksum block. EDRDG redistribution requirement. |
| `public/data/build-manifest.json` | Pinned source SHAs, policy knobs, output SHAs — proves a given deploy matches a given build. |

## Stages

| # | Module | What it does |
|---|---|---|
| 0 | `stage0_acquire` | Validates inputs, checksums them, unzips `grammar.zip`, resolves the grammar metadata via the two-branch `index.json` ↔ config lookup. |
| 1 | `stage1_words` | Streams JMdict via `iterparse`, expands DTD entities back to their short names, emits one key per `keb` (or per primary `reb` for kana-only entries). Senses are restricted per key by `stagk`/`stagr`. |
| 2 | `stage2_sentences` | Tokenizes every Japanese sentence with MeCab+IPADIC (the same dictionary as the app's Kuromoji+IPADIC) and links sentences to entries by matching `basic_form` tokens against the `words` keys. The TSV has no per-sentence headword annotations — linkage is derived here. |
| 3 | `stage3_readings` | Builds the kana → `[kanji, …]` inverse index used by the parser's fallback path; ordered by descending frequency score. |
| 4 | `stage4_grammar` | Validates every term-bank entry (8-tuple, structured-content body, three `【 … 】` markers, JLPT level in index 7), then concatenates entries across files sorted by their numeric suffix. |
| 5 | `stage5_assemble` | Caps examples per entry (default 3, shortest first), drops sentences that ended up unreferenced, assigns indices in one deterministic pass, gzips the bundle, and writes the manifest + attribution. |
| 5b | `stage5b_gloss_index` | Walks the finalized vocab map and the merged grammar bank, normalizes each gloss (lowercase → strip parentheticals → drop stopwords → naïve suffix-stem), and emits unigram + 2..4-gram phrase posting maps for both kinds. The normalizer here is the runtime twin of [`app/lib/engine/glossQuery.ts`](../app/lib/engine/glossQuery.ts) — divergence silently kills recall. |
| 6 | `stage6_validate` | Build-failing checks: schema shape, sentence-index integrity, tokenizer alignment on common probes, readings round-trip, grammar renderability, manifest consistency, gzip integrity. Also validates the gloss index — per-section bounds, posting integrity (every `(head, sense)` row resolves), and a size budget. |

## Policy knobs

All in [`data_pipeline/config.py`](data_pipeline/config.py):

- `examples_per_entry` — per-entry sentence cap (default 3; v1 displays one).
- `best_sentence_rule` — `"shortest"` picks short ja text; tie-breaks by `ja_id`.
- `pos_policy` — `"short"` stores JMdict entity names (`n`, `v5r`); the parser keys on these.
- `gzip_level` — deterministic gzip level (no mtime, no filename header).
- `GRAMMAR_METADATA` — fields used when the Yomitan ZIP has no `index.json`. Pinned to the current `data/grammar.zip` snapshot.
- `GLOSS_STOPWORDS` — English words filtered before indexing / querying. Keeps articles, prepositions, conjunctions, and inflected auxiliaries; intentionally retains base verbs (be/have/do), modals, negations, and content pronouns so they're searchable. The runtime stopword list in `app/lib/engine/glossQuery.ts` must stay aligned.
- `gloss_max_phrase_len` — max n-gram length emitted under the `p` posting maps (default 4).
- `gloss_max_postings_per_key` — per-key posting cap (default 200), applied after sort by canonicity bucket × quality.

## Reproducibility

- Inputs are SHA-256'd at Stage 0; results land in `build-manifest.json`.
- Gzip is written with `mtime=0` and no filename header, so identical inputs produce byte-identical outputs.
- Stage 2 sorts by `ja_id` before assigning indices; per-entry tie-breaks use `ja_id`. Reruns produce identical bundles.
