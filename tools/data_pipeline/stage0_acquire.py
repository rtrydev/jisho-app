"""Stage 0 — source acquisition & pinning.

This pipeline never downloads anything: the operator drops the three sources
into ``data/``. This stage verifies they exist, checksums them, unzips the
grammar archive, and resolves the grammar source metadata (from the ZIP's
``index.json`` when present, otherwise from the ``grammar_metadata`` config
block — both branches yield the same field set).
"""

from __future__ import annotations

import json
import shutil
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import (
    GRAMMAR_METADATA,
    GRAMMAR_ZIP_PATH,
    JMDICT_PATH,
    SENTENCES_PATH,
    WORK_DIR,
)
from .util import StageLog, human_bytes, sha256_file


@dataclass
class SourceRecord:
    name: str
    path: str
    bytes: int
    sha256: str


@dataclass
class GrammarMetadataResolved:
    title: str
    revision: str
    format: int
    author: str
    attribution: str
    license: str
    source: str  # "index.json" | "config"


@dataclass
class Stage0Result:
    sources: list[SourceRecord]
    grammar_metadata: GrammarMetadataResolved
    grammar_work_dir: Path
    grammar_term_bank_files: list[Path]


def _require_file(path: Path, name: str) -> SourceRecord:
    if not path.exists():
        raise SystemExit(
            f"Missing pipeline input: {name} at {path}. See data/README.md."
        )
    size = path.stat().st_size
    digest = sha256_file(path)
    return SourceRecord(name=name, path=str(path), bytes=size, sha256=digest)


def _unzip_grammar(zip_path: Path, dest: Path, log: StageLog) -> list[Path]:
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)
    # Walk for term_bank_*.json regardless of nested folders.
    term_banks = sorted(
        dest.rglob("term_bank_*.json"),
        key=lambda p: _termbank_sort_key(p.name),
    )
    if not term_banks:
        raise SystemExit(
            f"grammar.zip contains no term_bank_*.json files (looked in {dest})"
        )
    log.info(f"unzipped grammar.zip → {len(term_banks)} term-bank files")
    return term_banks


def _termbank_sort_key(name: str) -> int:
    # "term_bank_3.json" -> 3
    stem = name.rsplit(".", 1)[0]
    suffix = stem.rsplit("_", 1)[-1]
    return int(suffix)


def _resolve_grammar_metadata(work_dir: Path) -> GrammarMetadataResolved:
    """Two-branch lookup as specified.

    Both branches produce the same field set. Absence of ``index.json`` is
    not a warning — it is one of the two expected paths.
    """
    index_path = work_dir / "index.json"
    # Yomitan archives sometimes nest one directory deep.
    if not index_path.exists():
        for cand in work_dir.glob("*/index.json"):
            index_path = cand
            break

    if index_path.exists():
        raw = json.loads(index_path.read_text(encoding="utf-8"))
        return GrammarMetadataResolved(
            title=str(raw.get("title", GRAMMAR_METADATA.title)),
            revision=str(raw.get("revision", GRAMMAR_METADATA.revision)),
            format=int(raw.get("format", GRAMMAR_METADATA.format)),
            author=str(raw.get("author", GRAMMAR_METADATA.author)),
            attribution=str(raw.get("attribution", GRAMMAR_METADATA.attribution)),
            license=str(raw.get("license", GRAMMAR_METADATA.license)),
            source="index.json",
        )

    return GrammarMetadataResolved(
        **asdict(GRAMMAR_METADATA),
        source="config",
    )


def run(log: StageLog) -> Stage0Result:
    log.stage("Stage 0 — source acquisition & pinning")

    sources = [
        _require_file(JMDICT_PATH, "JMdict_e.gz"),
        _require_file(SENTENCES_PATH, "sentence_pairs.tsv"),
        _require_file(GRAMMAR_ZIP_PATH, "grammar.zip"),
    ]
    for s in sources:
        log.info(f"{s.name}: {human_bytes(s.bytes)}  sha256={s.sha256[:12]}…")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    grammar_work = WORK_DIR / "grammar"
    term_banks = _unzip_grammar(GRAMMAR_ZIP_PATH, grammar_work, log)
    meta = _resolve_grammar_metadata(grammar_work)
    log.info(f"grammar metadata resolved from: {meta.source}")
    log.info(f"  title={meta.title!r}  license={meta.license!r}")

    log.done()
    return Stage0Result(
        sources=sources,
        grammar_metadata=meta,
        grammar_work_dir=grammar_work,
        grammar_term_bank_files=term_banks,
    )
