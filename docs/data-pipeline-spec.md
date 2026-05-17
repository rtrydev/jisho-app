# JishoParser — Data Preparation Pipeline Plan

**Version:** 1.0 (finalized)
**Language:** Python
**Status:** All design decisions locked; ready for implementation
**Scope:** Reproducibly build the static data artifacts the JishoParser v2 app consumes — the gzipped vocabulary dictionary, the merged grammar bank, the loader manifest, and the attribution file.

---

## 1. Overview

The app is fully client-side and loads three kinds of data as static assets: a compiled vocabulary dictionary, a grammar bank, and a morphology engine. The morphology engine (Kuromoji + IPADIC) is a bundled code library, not a pipeline output, and is out of scope here.

This pipeline produces, from pinned upstream sources, the following deliverables:

- `dictionary.json.gz` — a single gzipped JSON object containing `meta`, `words`, `readings`, and `sentences`.
- A merged, gzipped grammar bank (e.g. `grammar.json.gz`) built from the Yomitan dictionary's 4 term-bank files.
- A grammar manifest declaring the grammar artifact(s) and the source dictionary's metadata.
- An attribution/license file covering every upstream source.
- A build manifest with pinned source versions and output checksums.

The pipeline is a sequence of independent, idempotent stages plus a final assembly step. Given identical pinned inputs it produces byte-identical outputs, so any rebuild is verifiable and diffable.

### 1.1 Locked decisions

These were resolved during design and are no longer open:

- The pipeline is written in **Python**.
- The **Yomitan grammar ZIP is operator-supplied**; the pipeline validates and transforms it rather than sourcing it.
- The Yomitan ZIP's `index.json` is **treated as optional**. When present, the pipeline reads source metadata from it; when absent, it reads the same fields from a `grammar_metadata` block in the pipeline config. The current `data/grammar.zip` has no `index.json` and uses the config-supplied branch; the pipeline does not fail or warn on this case.
- The Yomitan ZIP contains **4 term-bank files** (the v1 grammar bank shipped with the previous website, recovered from `archive/jisho_old.zip` and placed at `data/grammar.zip`). The v1 four-file hardcoding is abandoned in favor of a **manifest-driven loader** in v2 so the source can be swapped without app changes.
- Because v2 is **mobile-first**, the grammar term banks are **merged into a single gzipped artifact** rather than served as separate requests.
- The vocabulary output **retains the v1 `{meta, words, readings, sentences}` schema** so it remains a drop-in for the existing parser; only the grammar-loading mechanism changes in v2.

---

## 2. Required inputs (acquire before running)

| # | Source | Feeds | Format | License |
|---|--------|-------|--------|---------|
| 1 | **JMdict** (English variant sufficient) | `words`, derived `readings` | gzipped XML | EDRDG, CC Attribution-ShareAlike |
| 2 | **Tatoeba / Tanaka examples**, JMdict-aligned variant | `sentences` + entry linkage | indexed sentence dataset keyed to JMdict sequence numbers | EDRDG / CC Attribution family |
| 3 | **Yomitan grammar dictionary** (v1 bank shipped with the previous website; recovered from `archive/jisho_old.zip` and pinned at `data/grammar.zip`) | `term_bank_*.json` → merged grammar bank | bare `.zip` (4 term banks; `index.json` optional — absent in this v1 snapshot) | From `index.json` when present; otherwise from the pipeline's `grammar_metadata` config block (current snapshot: "v1 jisho-app grammar bank", license unspecified) |

The release date/version of sources 1 and 2 must be recorded at acquisition time; they are non-reproducible if the snapshot is not pinned. Source 3's `index.json` is **optional**: when present, the pipeline reads title/revision/format/author/attribution/license from it; when absent (as in the current v1 snapshot at `data/grammar.zip`), it reads the same fields from a `grammar_metadata` block in the pipeline config, pinned to the archive checksum. Both branches produce a complete build manifest — there is no "missing metadata" failure mode and no expectation that a real `index.json` will materialize.

---

## 3. Pipeline stages

### Stage 0 — Source acquisition & pinning

Fetch (or accept operator-placed) the three sources into a local input directory, then freeze them.

- JMdict and Tatoeba/Tanaka are downloaded and checksummed; their release identifiers are recorded.
- The Yomitan ZIP is operator-supplied. The stage unzips it to a working area and checksums the archive. The pipeline then resolves grammar source metadata (title, revision, format, author, attribution, license) via a two-branch lookup: if `index.json` is present in the ZIP, those fields are read from it; otherwise they are read from the `grammar_metadata` block in the pipeline config and pinned to the archive checksum. Both branches write the same field set into the build manifest — neither is a fallback or a degraded mode. The absence of `index.json` is not a warning.
- Output of this stage: local pinned copies plus a partial build manifest recording every source's version and checksum.

The rest of the pipeline runs entirely offline against these pinned copies.

### Stage 1 — Vocabulary (`words`)

Parse JMdict into the compact `words` map keyed by headword.

- **Headword/key selection.** The key must be the dictionary form Kuromoji+IPADIC emits as `basic_form`, since the parser looks that up first: typically the primary kanji form, falling back to the kana form for kana-only entries. This alignment is the single most important correctness property in the pipeline and is explicitly validated in Stage 6.
- **Sense compaction.** Each JMdict sense becomes one `{pos, glosses, misc}` object; POS/misc entity codes are normalized per the configured policy.
- **Readings.** The `r` array is the entry's kana readings, deduplicated and ordered.
- **Example slots.** The `e` index array cannot be populated here; it is filled during assembly once `sentences` indices are stable.
- **Filtering policy.** Configurable. Default: keep all entries (full coverage) unless final artifact size proves problematic.

### Stage 2 — Sentences (`sentences` + linkage)

Build the global `[ja, en][]` array and resolve entry→example links.

- Each example becomes a `[ja, en]` pair at a stable index.
- Linkage data resolves into per-entry index lists. A bounded number of examples per entry is kept (default: best 1–3; v1 displays one). "Best" rule is configurable (default: shortest adequate sentence / dataset's own quality ordering).
- Sentences referenced by no entry are dropped.
- Index stability is mandatory: indices are assigned once, in assembly, and both `sentences` and every `words[*].e` must agree. No reordering after assignment.

### Stage 3 — Readings (derived `readings` index)

Build the kana→kanji inverse index used by the parser's fallback path.

- For every entry with both kana readings and a kanji headword, map each reading to the list of kanji headwords sharing it.
- Ambiguous readings: kanji list ordered by frequency so the fallback picks the most likely word.
- Kana-only words are excluded (already resolved by the primary lookup path).

### Stage 4 — Grammar (merge of the term banks)

Transform the operator-supplied Yomitan term banks into a single mobile-friendly artifact.

- **Validation first.** For each `term_bank_*.json` file (4 in the v1 snapshot at `data/grammar.zip`, totalling 913 entries), verify the 8-tuple shape, confirm the Yomitan v3 structured-content format, confirm the `【 Meaning 】 / 【 Explanation 】 / 【 Example sentences 】` section markers (English text in full-width brackets *with internal spaces* — the literal strings the `GrammarNode` renderer keys on) are present in entry content, and confirm the **definition-tags field (entry tuple index 7)** carries the JLPT level the card displays (`N1`–`N5`). The earlier *term-tags* field (index 2) carries the kana reading of the headword and is not what the JLPT badge reads from.
- **Merge.** Concatenate the entry arrays of all term banks, in deterministic order (sorted by the numeric suffix of the filename), into a single combined entry list. This is a mechanical merge — entry contents are passed through byte-for-byte; no structured-content rewriting. The renderer only ever sees the combined entry list and is unaffected by the merge.
- **Compress.** Gzip the merged list deterministically (fixed level, no embedded timestamp), reusing the same gzip approach as the vocab artifact so the app decompresses it with the existing pako path.
- **Rationale.** Multiple separate fetches hurt cold-start on mobile (the v2 priority target); one gzipped artifact is a single request and one decompress. The pipeline reads the term-bank file count from the ZIP rather than hardcoding it, so a future swap to a larger grammar source needs no code change.

### Stage 5 — Assembly & packaging

- Combine `words`, `readings`, `sentences`, and a `meta` block (word count, sentence count, version string traceable to the JMdict snapshot, description) into one JSON object; gzip deterministically → `dictionary.json.gz`.
- Emit the **grammar manifest**: the grammar artifact filename(s) plus the source dictionary's title, revision, and license — drawn from `index.json` when present, or from the pipeline's `grammar_metadata` config block when absent (resolved in Stage 0). The v2 loader reads this manifest instead of hardcoding filenames and does not care which branch produced the values.
- Place all artifacts in the app's static-asset output location.

### Stage 6 — Validation (build-failing)

The correctness backstop. Any violation fails the build.

- **Index integrity:** every `words[*].e` index resolves to a valid `sentences` slot; no dangling or out-of-range references.
- **Tokenizer alignment:** a sample of common words run through Kuromoji+IPADIC produces a `basic_form` that exists as a key in `words`. Directly tests the property lookups depend on.
- **Readings round-trip:** sampled kana readings resolve to kanji keys that exist in `words`.
- **Grammar renderability:** sampled merged grammar entries have the structured-content shape, all three `【 Meaning 】 / 【 Explanation 】 / 【 Example sentences 】` section markers (English text in full-width brackets with internal spaces), and a definition-tags field (index 7) holding a JLPT level in `{N1, N2, N3, N4, N5}`.
- **Schema conformance:** the assembled vocab object matches the exact v1 `{meta, words, readings, sentences}` shape.
- **Manifest consistency:** the grammar manifest references artifacts that exist and decompress cleanly.
- **Size/sanity bounds:** entry and sentence counts fall within expected ranges (catches truncated or empty upstream downloads).

---

## 4. Cross-cutting concerns

**Attribution/license deliverable.** A first-class output, shipped with the data. Lists each source, its pinned version, and its license: JMdict (EDRDG, CC Attribution-ShareAlike), Tanaka/Tatoeba (EDRDG / CC Attribution family), and the grammar dictionary (license as declared in its Yomitan `index.json` when present, or from the pipeline's `grammar_metadata` config block when the ZIP has no `index.json`). EDRDG sources require attribution and share-alike for the public site; this file is a redistribution requirement, not optional polish. The grammar entry in the attribution file is sourced through the same two-branch resolution as the build manifest, so the file is always complete regardless of which branch was used.

**Configuration surface.** All policy knobs in one place, not scattered: vocab filtering, examples-per-entry cap, "best sentence" rule, POS/misc normalization mode, gzip level, and the `grammar_metadata` block (title, revision, format, author, attribution, license) that supplies grammar source metadata when the ZIP has no `index.json`. Regenerating with different tradeoffs — or swapping in a grammar source that does ship an `index.json` — is then a single config change.

**Reproducibility.** Pinned source versions + deterministic gzip + a checksum manifest of all inputs and outputs. Any rebuild is verifiable, and the deployed data can be proven to match a known build.

**Idempotency.** Every stage re-runnable against pinned inputs with byte-identical output, so reruns are safe and diffs are meaningful.

---

## 5. v2 application change implied by this pipeline

One small, contained loader change in the app, isolated to grammar-asset discovery:

- v1 fetched four hardcoded `term_bank_*.json` paths.
- v2 fetches the **grammar manifest**, then loads the single merged, gzipped grammar artifact it names, decompressing it with the existing pako path.

Parsing, the 6-token grammar matching window, the readings→kanji fallback, the dedup/POS filter, and the `GrammarNode` renderer are all unchanged — only *how the grammar file list is discovered and that it arrives gzipped* changes. This also future-proofs grammar swaps: a different or updated Yomitan dictionary regenerates the manifest and artifact with zero app code changes.

---

## 6. Build order

1. Stage 0 — acquire & pin all three sources; resolve grammar source metadata from `index.json` or from the `grammar_metadata` config block.
2. Stages 1–3 — vocabulary, sentences, readings (coordinated; indices assigned in assembly).
3. Stage 4 — validate and merge the grammar term banks (4 for the v1 default; the count is read from the ZIP, not hardcoded).
4. Stage 5 — assemble, gzip, emit manifest and attribution.
5. Stage 6 — validate; fail the build on any violation.

No open design questions remain.
