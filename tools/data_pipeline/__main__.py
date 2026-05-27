"""Pipeline driver.

Usage: ``python -m tools.data_pipeline``

Stages run in declared order; each surfaces its progress and timings to
stderr. Outputs land in ``public/data/`` (see ``config.py``).
"""

from __future__ import annotations

import sys

from .util import StageLog
from . import (
    stage0_acquire,
    stage1_words,
    stage2_sentences,
    stage3_readings,
    stage4_grammar,
    stage5_assemble,
    stage5b_gloss_index,
    stage6_validate,
    stage7_kanji,
)
from .config import BUILD_MANIFEST_OUT


def main(argv: list[str]) -> int:
    log = StageLog()

    stage0 = stage0_acquire.run(log)
    words = stage1_words.run(log)

    sentence_candidates = stage2_sentences.run(log, set(words.keys()))
    readings = stage3_readings.run(log, words)
    grammar_merged = stage4_grammar.run(log, stage0.grammar_term_bank_files)

    assembly = stage5_assemble.run(
        log,
        words=words,
        readings=readings,
        sentence_candidates=sentence_candidates,
        grammar_merged=grammar_merged,
        sources=stage0.sources,
        grammar_meta=stage0.grammar_metadata,
    )

    # Stage 5b consumes the finalized words map (with sentence indices
    # back-filled) and the merged grammar list so postings align 1:1 with the
    # runtime resources.
    gloss = stage5b_gloss_index.run(
        log,
        words=assembly["dict_obj"]["words"],
        grammar_entries=grammar_merged,
    )

    # Stage 7 produces kanji + radical artifacts. Optional — skipped when
    # KANJIDIC2 / RADKFILE2 aren't in data/. The runtime falls back to
    # disabling the radical-search tab.
    kanji = stage7_kanji.run(log, words=words)

    outputs = {**assembly["outputs"], **gloss["outputs"]}
    counts = {**assembly["counts"], **gloss["counts"]}
    if kanji is not None:
        outputs.update(kanji.outputs)
        counts.update(kanji.counts)
    stage5_assemble.write_build_manifest(
        assembly["sources"], assembly["grammar_meta"], outputs, counts
    )
    log.info(f"build manifest → {BUILD_MANIFEST_OUT.name}")

    stage6_validate.run(
        log, assembly["dict_obj"], grammar_merged, gloss_index=gloss["obj"]
    )

    log.stage("Done")
    log.info(
        f"words={counts['words']:,}  readings={counts['readings']:,}  "
        f"sentences={counts['sentences']:,}  grammar={counts['grammar_entries']:,}  "
        f"entries-with-examples={counts['entries_with_examples']:,}"
    )
    log.info(
        f"gloss-index vocab: u={counts['gloss_vocab_unigram_keys']:,}  "
        f"p={counts['gloss_vocab_phrase_keys']:,}  "
        f"postings={counts['gloss_vocab_unigram_postings'] + counts['gloss_vocab_phrase_postings']:,}"
    )
    log.info(
        f"gloss-index grammar: u={counts['gloss_grammar_unigram_keys']:,}  "
        f"p={counts['gloss_grammar_phrase_keys']:,}  "
        f"postings={counts['gloss_grammar_unigram_postings'] + counts['gloss_grammar_phrase_postings']:,}"
    )
    if kanji is not None:
        log.info(
            f"kanji: classes={counts['kanji_classes']:,}  "
            f"metadata={counts['kanji_metadata']:,}  "
            f"radicals={counts['radicals']:,}"
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
