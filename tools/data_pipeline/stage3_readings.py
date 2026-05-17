"""Stage 3 — kana→kanji readings index.

The parser's fallback path goes: tokenizer's base form not found in
``words`` → look up the token's reading (kana) in ``readings`` → walk the
returned kanji headwords until a match is found in ``words``.

Each kanji headword is included under every reading it carries. The kanji
list under a reading is ordered by descending frequency score so the
fallback prefers the most common candidate.
"""

from __future__ import annotations

from collections import OrderedDict, defaultdict

from .util import StageLog


def _is_kana_only(key: str) -> bool:
    # CJK Unified Ideographs + extension A,B + compatibility kanji.
    for ch in key:
        cp = ord(ch)
        if (
            0x4E00 <= cp <= 0x9FFF
            or 0x3400 <= cp <= 0x4DBF
            or 0xF900 <= cp <= 0xFAFF
            or 0x20000 <= cp <= 0x2A6DF
        ):
            return False
    return True


def run(log: StageLog, words: "OrderedDict[str, dict]") -> "OrderedDict[str, list[str]]":
    log.stage("Stage 3 — kana→kanji readings index")
    inverse: "defaultdict[str, list[tuple[int, str]]]" = defaultdict(list)

    n_kanji_keys = 0
    for key, entry in words.items():
        if _is_kana_only(key):
            continue
        n_kanji_keys += 1
        freq = entry.get("f", 0)
        for reading in entry["r"]:
            inverse[reading].append((freq, key))

    # Materialize, sorted by descending frequency then key (stable).
    readings: "OrderedDict[str, list[str]]" = OrderedDict()
    for reading in sorted(inverse.keys()):
        bucket = sorted(inverse[reading], key=lambda t: (-t[0], t[1]))
        readings[reading] = [k for _, k in bucket]

    log.info(f"indexed {n_kanji_keys:,} kanji keys → "
             f"{len(readings):,} distinct readings "
             f"(avg {sum(len(v) for v in readings.values()) / max(len(readings), 1):.2f} kanji per reading)")
    log.done()
    return readings
