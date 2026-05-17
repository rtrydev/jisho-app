# `data/` — Pipeline source inputs

This directory holds the **operator-supplied source files** consumed by the
JishoParser data-preparation pipeline described in
[../docs/data-pipeline-spec.md](../docs/data-pipeline-spec.md). These are
upstream snapshots, not pipeline outputs; they are gitignored and must be placed
here manually before a build.

The pipeline (Stage 0) pins, checksums, and freezes whatever it finds here, then
the rest of the build runs offline against these copies.

## Required files

| Filename             | Source                                                                                   | Feeds                                     | Format                                                                                                       | License                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `JMdict_e.gz`        | JMdict (English variant)                                                                 | `words`, derived `readings` (Stages 1, 3) | Gzipped XML; root `<JMdict>` with `<entry>` children                                                          | EDRDG, CC BY-SA 4.0 — attribution + share-alike required                                         |
| `sentence_pairs.tsv` | Tatoeba / Tanaka, JMdict-aligned subset                                                  | `sentences` + entry linkage (Stage 2)     | UTF-8 TSV, 4 columns: `ja_id \t ja_text \t en_id \t en_text`; indices key into JMdict / Tatoeba              | EDRDG / CC BY 2.0 FR (Tatoeba)                                                                   |
| `grammar.zip`        | v1 grammar bank shipped with the previous website (recovered from `archive/jisho_old.zip`) | merged grammar bank (Stage 4)             | Bare Yomitan-v3-style ZIP: **4** `term_bank_*.json` (8-tuple entries with structured content); no `index.json` | Unspecified in the archive; recorded as "v1 jisho-app grammar bank" pending provenance recovery |

All three are non-reproducible without pinning — record each source's release
date/version at acquisition time.

### The grammar dictionary's renderer contract

What `GrammarNode` keys on inside each entry (Stage 4 validation enforces all of
these, and they're confirmed present across every entry in the current
`grammar.zip`):

- **Format.** Yomitan v3 8-tuple. Index 0 = headword (kanji form when
  available), 1 = unused, 2 = term-tags (the kana reading of the headword), 3 =
  rules/POS, 4 = score, 5 = structured-content body, 6 = sequence number, 7 =
  definition-tags (the JLPT level).
- **Section markers.** Inside the structured-content body, the literal strings
  `【 Meaning 】`, `【 Explanation 】`, `【 Example sentences 】` — English text,
  full-width brackets, **with internal spaces**. All three must be present per
  entry.
- **JLPT level.** Index 7 of the tuple holds the JLPT level as one of `N1`,
  `N2`, `N3`, `N4`, `N5`. This is what the card displays; index 2 is the
  reading, not the level.

## Acceptance checks the pipeline performs

Stage 0 and Stage 6 fail the build if any of these are off, so it's worth
sanity-checking inputs before kicking off a run:

- **`JMdict_e.gz`** — decompresses to valid XML; entry count within expected
  bounds (currently ~217k entries).
- **`sentence_pairs.tsv`** — non-empty; tab-delimited 4-column rows; UTF-8
  decodable; line count in expected range (hundreds of thousands).
- **`grammar.zip`** — opens cleanly; contains the expected `term_bank_*.json`
  files (the validator reads the count from the ZIP, not from a hardcode); each
  entry is an 8-tuple with `structured-content`; every entry carries all three
  `【 Meaning 】 / 【 Explanation 】 / 【 Example sentences 】` markers; index-7
  value is one of `N1`–`N5`.

## Current contents — validation snapshot

What's currently sitting in this directory (gitignored, so not committed):

| Filename             | Status                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JMdict_e.gz`        | **OK.** Gzip integrity passes; XML root is `<JMdict>`; ~217,056 `<entry>` elements.                                                                                                                                                                                                                                                                                                                  |
| `sentence_pairs.tsv` | **OK.** 280,276 rows, 4 tab-separated columns matching `ja_id, ja, en_id, en`. The first row carries a UTF-8 BOM (`﻿`); the Stage 2 parser must strip it.                                                                                                                                                                                                                                       |
| `grammar.zip`        | **OK.** 4 `term_bank_*.json` files, 913 entries total (229/228/228/228). Every entry has all three `【 Meaning 】 / 【 Explanation 】 / 【 Example sentences 】` markers and a populated index-7 JLPT tag. Distribution: N5 126, N4 176, N3 219, N2 213, N1 179. No `index.json`, so license/version metadata is operator-recorded against the archive checksum at Stage 0 rather than read from the ZIP. |

All three pipeline inputs are present and valid. The build can run as soon as
the Stage 0 manifest-recording step is wired up to handle the missing
`index.json` case (record the operator-supplied defaults instead of failing).

## Related: `archive/`

The full v1 source bundle has been parked at
[../archive/jisho_old.zip](../archive/jisho_old.zip) — kept locally for
reference (e.g. recovering the engine code, the original `GrammarNode`
renderer, or grammar-bank provenance metadata) and gitignored so it doesn't
ship in the repo. `data/grammar.zip` is the relevant subset extracted from
there; everything else in `jisho_old.zip` is reference-only and not consumed by
the pipeline.

## Where to put new sources

Drop replacement files straight into this directory using the filenames above.
If you swap to a different grammar dictionary, either name its archive
`grammar.zip` to match the existing [../.gitignore](../.gitignore) entry, or
extend the `# data pipeline sources` block in `.gitignore` with the new
filename so it stays out of the repo.
