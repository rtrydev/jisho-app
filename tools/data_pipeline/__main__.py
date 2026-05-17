"""Pipeline driver.

Usage: ``python -m tools.data_pipeline``

Stages run in declared order; each surfaces its progress and timings to
stderr. Outputs land in ``public/data/`` (see ``config.py``).
"""

from __future__ import annotations

import sys

from .util import StageLog
from . import stage0_acquire, stage1_words, stage2_sentences, stage3_readings, stage4_grammar, stage5_assemble, stage6_validate


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

    stage6_validate.run(log, assembly["dict_obj"], grammar_merged)

    log.stage("Done")
    counts = assembly["counts"]
    log.info(
        f"words={counts['words']:,}  readings={counts['readings']:,}  "
        f"sentences={counts['sentences']:,}  grammar={counts['grammar_entries']:,}  "
        f"entries-with-examples={counts['entries_with_examples']:,}"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
