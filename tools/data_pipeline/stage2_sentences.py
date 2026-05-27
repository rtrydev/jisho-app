"""Stage 2 — sentences and entry linkage.

The TSV is bare ``ja_id / ja / en_id / en``; it ships no per-sentence
headword annotations. Linkage is therefore derived morphologically: each
Japanese sentence is run through MeCab+IPADIC (the Python equivalent of
the app's Kuromoji+IPADIC tokenizer), and every ``basic_form`` whose token
matches a ``words`` key is treated as a link from the sentence to that
entry. Surface forms are also probed as a fallback for kana-only entries
that the tokenizer sometimes returns with ``*`` as ``basic_form``.

The function returns a deterministic list of ``(ja, en, entry_keys)``
candidate sentences. Stage 5 assigns the final ``sentences`` indices and
back-fills ``words[*].e``.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import fugashi
import ipadic

from .config import SENTENCES_PATH
from .util import StageLog


_BOM = "﻿"


@dataclass
class SentenceCandidate:
    ja_id: int
    ja: str
    en: str
    entry_keys: list[str]  # deduplicated, ordered by first-seen


def _iter_tsv_rows(path) -> Iterable[tuple[int, str, str]]:
    with path.open("r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            if lineno == 1 and line.startswith(_BOM):
                line = line[len(_BOM):]
            if not line:
                continue
            line = line.rstrip("\n").rstrip("\r")
            parts = line.split("\t")
            if len(parts) != 4:
                continue
            ja_id_s, ja, _en_id, en = parts
            if not ja or not en:
                continue
            try:
                ja_id = int(ja_id_s)
            except ValueError:
                continue
            yield ja_id, ja, en


def _make_tagger() -> "fugashi.GenericTagger":
    return fugashi.GenericTagger(ipadic.MECAB_ARGS)


def run(log: StageLog, word_keys: set[str]) -> list[SentenceCandidate]:
    log.stage("Stage 2 — sentences and entry linkage")
    if not SENTENCES_PATH.exists():
        log.info(
            f"skipping — {SENTENCES_PATH.name} absent. "
            f"`words[*].e` will be empty arrays and `sentences` an empty list."
        )
        log.done()
        return []
    tagger = _make_tagger()
    log.info("tagger ready (MeCab + IPADIC)")

    candidates: list[SentenceCandidate] = []
    n_rows = 0
    n_linked = 0
    n_links_total = 0

    for ja_id, ja, en in _iter_tsv_rows(SENTENCES_PATH):
        n_rows += 1
        linked: list[str] = []
        seen: set[str] = set()
        for tok in tagger(ja):
            feat = tok.feature
            # IPADIC tuple: ... feat[6] = base form, "*" if unknown.
            base = feat[6] if len(feat) > 6 else None
            surface = tok.surface
            for cand in (base, surface):
                if not cand or cand == "*" or cand in seen:
                    continue
                if cand in word_keys:
                    linked.append(cand)
                    seen.add(cand)
        if linked:
            candidates.append(SentenceCandidate(ja_id=ja_id, ja=ja, en=en, entry_keys=linked))
            n_linked += 1
            n_links_total += len(linked)
        if n_rows % 50_000 == 0:
            log.info(f"  tokenized {n_rows:,} rows → {n_linked:,} linked  "
                     f"({n_links_total:,} total links)")

    log.info(f"tokenized {n_rows:,} rows; kept {n_linked:,} linked sentences "
             f"({n_links_total:,} total links, "
             f"avg {n_links_total / max(n_linked, 1):.1f} per sentence)")
    log.done()
    return candidates
