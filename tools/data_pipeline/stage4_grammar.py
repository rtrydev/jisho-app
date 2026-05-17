"""Stage 4 — grammar bank merge.

The Yomitan archive is a v3 8-tuple format. Each ``term_bank_*.json`` is a
list of entries; we validate the shape and the renderer's three required
section markers (``【 Meaning 】 / 【 Explanation 】 / 【 Example sentences 】``
— English text in full-width brackets, with internal spaces) and that the
definition-tags field (index 7) carries a JLPT level. Entries are
concatenated in the file's natural order across term banks, sorted by the
numeric suffix in the filename, and emitted as a single gzipped artifact
so mobile loads it in a single request.

Entry contents are passed through byte-for-byte — the renderer continues to
operate on the same per-entry shape it consumed in v1.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .util import StageLog


_REQUIRED_MARKERS = ("【 Meaning 】", "【 Explanation 】", "【 Example sentences 】")
_VALID_JLPT = {"N1", "N2", "N3", "N4", "N5"}


def _content_text(node: Any) -> str:
    """Flatten a structured-content node into raw text for marker scanning."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_content_text(n) for n in node)
    if isinstance(node, dict):
        return _content_text(node.get("content"))
    return ""


def _validate_entry(entry: list, source_file: Path, idx: int) -> None:
    if not isinstance(entry, list) or len(entry) != 8:
        raise SystemExit(
            f"{source_file.name}[{idx}]: expected 8-tuple, got "
            f"{type(entry).__name__} of length "
            f"{len(entry) if isinstance(entry, list) else 'n/a'}"
        )
    headword, _unused1, kana_reading, _rules, _score, body, _seq, def_tags = entry
    # Index 0 is the kanji form when available; for grammar points written
    # in kana, it's empty and the kana reading at index 2 carries the
    # headword text. Either one must be present.
    if not (isinstance(headword, str) and (headword or (isinstance(kana_reading, str) and kana_reading))):
        raise SystemExit(
            f"{source_file.name}[{idx}]: no headword text in index 0 or index 2"
        )
    if not isinstance(body, list) or not body:
        raise SystemExit(f"{source_file.name}[{idx}]: missing body list (index 5)")
    head = body[0]
    if not (isinstance(head, dict) and head.get("type") == "structured-content"):
        raise SystemExit(
            f"{source_file.name}[{idx}]: body[0] is not Yomitan v3 structured-content"
        )
    flat = _content_text(head.get("content"))
    for marker in _REQUIRED_MARKERS:
        if marker not in flat:
            raise SystemExit(
                f"{source_file.name}[{idx}]: missing required marker {marker!r}"
            )
    if def_tags not in _VALID_JLPT:
        raise SystemExit(
            f"{source_file.name}[{idx}]: definition-tags (index 7) is {def_tags!r}; "
            f"expected one of {sorted(_VALID_JLPT)}"
        )


def run(log: StageLog, term_bank_files: list[Path]) -> list[list]:
    log.stage("Stage 4 — grammar bank validate + merge")
    log.info(f"merging {len(term_bank_files)} term-bank files (sorted by filename suffix)")

    merged: list[list] = []
    per_file_counts: list[int] = []
    jlpt_counts: dict[str, int] = {}

    for tb_path in term_bank_files:
        with tb_path.open("r", encoding="utf-8") as f:
            entries = json.load(f)
        if not isinstance(entries, list):
            raise SystemExit(f"{tb_path.name}: expected a JSON array of entries")
        for i, entry in enumerate(entries):
            _validate_entry(entry, tb_path, i)
            merged.append(entry)
            jlpt_counts[entry[7]] = jlpt_counts.get(entry[7], 0) + 1
        per_file_counts.append(len(entries))
        log.info(f"  {tb_path.name}: {len(entries):,} entries")

    dist = "  ".join(f"{k}={jlpt_counts.get(k, 0)}" for k in ("N5", "N4", "N3", "N2", "N1"))
    log.info(f"merged total: {len(merged):,} entries  JLPT: {dist}")
    log.done()
    return merged
