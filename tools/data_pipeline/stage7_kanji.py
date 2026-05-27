"""Stage 7 — kanji + radical artifacts.

Parses two operator-supplied EDRDG sources:

* ``kanjidic2.xml.gz`` — per-character metadata (strokes, JLPT, grade,
  frequency, on/kun readings, English meanings).
* ``radkfile2`` (or ``radkfile-u``) — radical → list of kanji. Plain UTF-8
  text in the EDRDG ``$ <radical> <strokes>`` format.

Both are optional. If either is missing, this stage logs and skips — the
existing app keeps working without the kanji/radical-search features.

Outputs (gzipped, deterministic):

* ``public/data/kanji.json.gz`` — ``{ schema, data: { kanji: {…meta} } }``
* ``public/data/radkfile.json.gz`` — ``{ schema, classes, radicals, byRadical }``
  where ``byRadical[r]`` is an array of *indices into classes*, so the
  browser can build Uint32 bitsets in one pass for fast AND intersection.

The kanji class set is mined from JMdict headwords (passed in from Stage 1)
and intersected with characters that appear in both KANJIDIC2 and the
radical file. That keeps every shipped kanji simultaneously: (a) lookup-able
in the dictionary, (b) describable by metadata, (c) findable via radicals.
"""

from __future__ import annotations

import gzip
import io
import re
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from .config import (
    KANJI_OUT,
    KANJIDIC2_PATH,
    POLICY,
    RADKFILE_CANDIDATES,
    RADKFILE_OUT,
    resolve_radkfile_path,
)
from .util import (
    StageLog,
    dumps_compact,
    human_bytes,
    sha256_bytes,
    write_gz,
)


@dataclass
class Stage7Result:
    kanji_gz_bytes: bytes
    radkfile_gz_bytes: bytes
    outputs: dict[str, dict]
    counts: dict[str, int]


# ---------- KANJIDIC2 -------------------------------------------------- #


@dataclass
class KanjiInfo:
    strokes: int
    jlpt: int | None
    grade: int | None
    freq: int | None
    on: list[str]
    kun: list[str]
    meanings: list[str]


def _parse_kanjidic2(path: Path) -> dict[str, KanjiInfo]:
    with gzip.open(path, "rb") as f:
        blob = f.read()
    out: dict[str, KanjiInfo] = {}
    ctx = ET.iterparse(io.BytesIO(blob), events=("end",))
    for _, elem in ctx:
        if elem.tag != "character":
            continue
        literal = elem.findtext("literal")
        if not literal:
            elem.clear()
            continue
        misc = elem.find("misc")
        strokes = 0
        jlpt: int | None = None
        grade: int | None = None
        freq: int | None = None
        if misc is not None:
            sc = misc.findtext("stroke_count")
            if sc:
                # First <stroke_count> is the accepted value; later are variants.
                strokes = int(sc)
            g = misc.findtext("grade")
            if g:
                grade = int(g)
            f = misc.findtext("freq")
            if f:
                freq = int(f)
            j = misc.findtext("jlpt")
            if j:
                jlpt = int(j)

        on: list[str] = []
        kun: list[str] = []
        meanings: list[str] = []
        rm = elem.find("reading_meaning")
        if rm is not None:
            # Use the first <rmgroup> only — additional groups are nanori
            # readings (name-only), not the main reading set.
            rmg = rm.find("rmgroup")
            if rmg is not None:
                for r in rmg.findall("reading"):
                    rtype = r.get("r_type")
                    text = r.text or ""
                    if rtype == "ja_on":
                        on.append(text)
                    elif rtype == "ja_kun":
                        kun.append(text)
                for m in rmg.findall("meaning"):
                    # Skip non-English meanings; m_lang absent = English.
                    if m.get("m_lang") is None and m.text:
                        meanings.append(m.text)

        out[literal] = KanjiInfo(
            strokes=strokes,
            jlpt=jlpt,
            grade=grade,
            freq=freq,
            on=on,
            kun=kun,
            meanings=meanings,
        )
        elem.clear()
    return out


# ---------- RADKFILE --------------------------------------------------- #


_RADKFILE_HEADER_RE = re.compile(r"^\$\s+(\S+)\s+(\d+)")


@dataclass
class RadkfileEntry:
    radical: str
    strokes: int
    kanji: list[str]


def _parse_radkfile(path: Path) -> list[RadkfileEntry]:
    # RADKFILE2 ships as UTF-8 these days; older snapshots were EUC-JP. Try
    # UTF-8 first, fall back to EUC-JP for compatibility with legacy dumps.
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        text = path.read_text(encoding="euc_jp")

    entries: list[RadkfileEntry] = []
    current: RadkfileEntry | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.startswith("#"):
            continue
        m = _RADKFILE_HEADER_RE.match(line)
        if m:
            if current is not None:
                entries.append(current)
            current = RadkfileEntry(
                radical=m.group(1),
                strokes=int(m.group(2)),
                kanji=[],
            )
            continue
        if current is None:
            # Stray content before any `$` header — skip.
            continue
        # Kanji lines: any non-whitespace character is a kanji entry.
        for ch in line:
            if ch.isspace():
                continue
            current.kanji.append(ch)
    if current is not None:
        entries.append(current)
    return entries


# ---------- mining the class set --------------------------------------- #


def _mine_jmdict_kanji(words: "OrderedDict[str, dict]") -> set[str]:
    """Every CJK ideograph that appears in at least one JMdict headword key."""
    out: set[str] = set()
    for keb in words.keys():
        for ch in keb:
            cp = ord(ch)
            if 0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF:
                out.add(ch)
    return out


def _intersect_class_set(
    jmdict_chars: set[str],
    kanji_info: dict[str, KanjiInfo],
    rad_entries: list[RadkfileEntry],
) -> list[str]:
    """The shipped class set is the intersection of all three sources.

    Sorted by ``(freq or 999999, codepoint)`` so common kanji land first
    (useful when the result list is truncated for display) and the order is
    deterministic.
    """
    rad_chars: set[str] = set()
    for e in rad_entries:
        rad_chars.update(e.kanji)
    overlap = jmdict_chars & set(kanji_info.keys()) & rad_chars

    def sort_key(ch: str) -> tuple[int, int]:
        f = kanji_info[ch].freq
        return (f if f is not None else 999_999, ord(ch))

    return sorted(overlap, key=sort_key)


# ---------- emit ------------------------------------------------------- #


def _build_kanji_payload(
    classes: list[str],
    kanji_info: dict[str, KanjiInfo],
    rad_entries: list[RadkfileEntry],
) -> dict:
    # Reverse the radical map to get per-kanji radical lists (deterministic
    # by stroke count then codepoint).
    radicals_for: dict[str, list[str]] = {ch: [] for ch in classes}
    rad_sorted = sorted(rad_entries, key=lambda e: (e.strokes, ord(e.radical)))
    for entry in rad_sorted:
        for k in entry.kanji:
            if k in radicals_for:
                radicals_for[k].append(entry.radical)

    data: dict[str, dict] = OrderedDict()
    for ch in classes:
        info = kanji_info[ch]
        record: dict = {"s": info.strokes}
        if info.jlpt is not None:
            record["j"] = info.jlpt
        if info.grade is not None:
            record["g"] = info.grade
        if info.freq is not None:
            record["f"] = info.freq
        if info.on:
            record["on"] = info.on
        if info.kun:
            record["kun"] = info.kun
        if info.meanings:
            record["m"] = info.meanings
        if radicals_for[ch]:
            record["r"] = radicals_for[ch]
        data[ch] = record

    return {
        "schema": "kanji/v1",
        "count": len(data),
        "data": data,
    }


def _build_radkfile_payload(
    classes: list[str],
    rad_entries: list[RadkfileEntry],
) -> dict:
    index_of: dict[str, int] = {ch: i for i, ch in enumerate(classes)}

    rad_meta: list[dict] = []
    by_radical: dict[str, list[int]] = {}
    # Deterministic order: ascending stroke count, then codepoint.
    for entry in sorted(rad_entries, key=lambda e: (e.strokes, ord(e.radical))):
        idxs = sorted({index_of[k] for k in entry.kanji if k in index_of})
        if not idxs:
            # Radical decomposes only kanji that didn't make the class set —
            # drop it so the picker doesn't show a dead radical.
            continue
        rad_meta.append({"c": entry.radical, "s": entry.strokes})
        by_radical[entry.radical] = idxs

    return {
        "schema": "radkfile/v1",
        "classes": classes,
        "radicals": rad_meta,
        "byRadical": by_radical,
    }


# ---------- driver ----------------------------------------------------- #


def run(
    log: StageLog,
    *,
    words: "OrderedDict[str, dict]",
) -> Stage7Result | None:
    log.stage("Stage 7 — kanji + radical artifacts")

    radkfile_path = resolve_radkfile_path()
    if not KANJIDIC2_PATH.exists() or radkfile_path is None:
        missing: list[str] = []
        if not KANJIDIC2_PATH.exists():
            missing.append(KANJIDIC2_PATH.name)
        if radkfile_path is None:
            missing.append(
                " or ".join(p.name for p in RADKFILE_CANDIDATES)
            )
        log.info(
            f"skipping — missing operator-supplied source(s): {', '.join(missing)}. "
            f"Run 'python -m tools.data_pipeline.fetch kanjidic2 kradfile' or "
            f"see data/README.md."
        )
        log.done()
        return None

    log.info(f"parsing {KANJIDIC2_PATH.name}…")
    kanji_info = _parse_kanjidic2(KANJIDIC2_PATH)
    log.info(f"  → {len(kanji_info):,} kanji metadata records")

    log.info(f"parsing {radkfile_path.name}…")
    rad_entries = _parse_radkfile(radkfile_path)
    log.info(f"  → {len(rad_entries):,} radical entries")

    jmdict_chars = _mine_jmdict_kanji(words)
    log.info(f"jmdict kanji: {len(jmdict_chars):,}")
    classes = _intersect_class_set(jmdict_chars, kanji_info, rad_entries)
    log.info(
        f"shipped class set (JMdict ∩ KANJIDIC2 ∩ RADKFILE): {len(classes):,}"
    )

    kanji_payload = _build_kanji_payload(classes, kanji_info, rad_entries)
    radkfile_payload = _build_radkfile_payload(classes, rad_entries)

    kanji_bytes = dumps_compact(kanji_payload, sort_keys=False)
    kanji_gz = write_gz(KANJI_OUT, kanji_bytes, POLICY.gzip_level)
    log.info(
        f"kanji.json:    {human_bytes(len(kanji_bytes))} → "
        f"{human_bytes(len(kanji_gz))} gzipped"
    )

    radkfile_bytes = dumps_compact(radkfile_payload, sort_keys=False)
    radkfile_gz = write_gz(RADKFILE_OUT, radkfile_bytes, POLICY.gzip_level)
    log.info(
        f"radkfile.json: {human_bytes(len(radkfile_bytes))} → "
        f"{human_bytes(len(radkfile_gz))} gzipped"
    )

    outputs = {
        "kanji.json.gz": {
            "path": KANJI_OUT.name,
            "bytes": len(kanji_gz),
            "sha256": sha256_bytes(kanji_gz),
        },
        "radkfile.json.gz": {
            "path": RADKFILE_OUT.name,
            "bytes": len(radkfile_gz),
            "sha256": sha256_bytes(radkfile_gz),
        },
    }
    counts = {
        "kanji_classes": len(classes),
        "kanji_metadata": len(kanji_info),
        "radicals": len(radkfile_payload["radicals"]),
    }

    log.done()
    return Stage7Result(
        kanji_gz_bytes=kanji_gz,
        radkfile_gz_bytes=radkfile_gz,
        outputs=outputs,
        counts=counts,
    )
