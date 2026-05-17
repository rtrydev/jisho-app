"""Stage 5 — assembly and packaging.

Assigns final sentence indices, back-fills ``words[*].e``, gzips the
combined ``{meta, words, readings, sentences}`` blob, gzips the merged
grammar, emits the loader manifest, the build manifest, and the
attribution file.
"""

from __future__ import annotations

import json
from collections import OrderedDict, defaultdict
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .config import (
    ATTRIBUTION_OUT,
    BUILD_MANIFEST_OUT,
    DICTIONARY_OUT,
    GRAMMAR_MANIFEST_OUT,
    GRAMMAR_OUT,
    OUTPUT_DIR,
    POLICY,
)
from .stage0_acquire import GrammarMetadataResolved, SourceRecord
from .stage2_sentences import SentenceCandidate
from .util import (
    StageLog,
    deterministic_gzip,
    dumps_compact,
    human_bytes,
    sha256_bytes,
    write_gz,
)


def _resolve_sentence_links(
    candidates: list[SentenceCandidate],
    words: "OrderedDict[str, dict]",
) -> tuple[list[list[str]], dict[str, list[int]]]:
    """Pick the global sentence ordering and the per-entry index lists.

    Algorithm:
      1. Group raw candidates by entry key.
      2. Cap each entry at ``POLICY.examples_per_entry``, picking by the
         best-rule (default: shortest ja text — ja_id is the tiebreaker,
         so reruns are deterministic).
      3. Union the picked candidates into the final sentences list;
         sentences referenced by no entry are dropped here.
      4. Sort the survivors by ``ja_id`` ascending and assign indices.
      5. Back-fill each entry's ``e`` with ascending indices.

    Index stability is enforced by assigning indices once, after dropping,
    in a single deterministic sort.
    """
    by_entry: "defaultdict[str, list[SentenceCandidate]]" = defaultdict(list)
    for c in candidates:
        for key in c.entry_keys:
            if key in words:
                by_entry[key].append(c)

    cap = POLICY.examples_per_entry
    picks_per_entry: dict[str, list[SentenceCandidate]] = {}
    survivors: dict[int, SentenceCandidate] = {}

    for key, cands in by_entry.items():
        if POLICY.best_sentence_rule == "shortest":
            cands.sort(key=lambda c: (len(c.ja), c.ja_id))
        else:
            cands.sort(key=lambda c: c.ja_id)
        picked = cands[:cap]
        picks_per_entry[key] = picked
        for c in picked:
            survivors.setdefault(c.ja_id, c)

    ordered = sorted(survivors.values(), key=lambda c: c.ja_id)
    sentences: list[list[str]] = [[c.ja, c.en] for c in ordered]
    id_to_idx: dict[int, int] = {c.ja_id: i for i, c in enumerate(ordered)}

    final: dict[str, list[int]] = {}
    for key, picks in picks_per_entry.items():
        idxs = sorted({id_to_idx[c.ja_id] for c in picks})
        final[key] = idxs
    return sentences, final


def _build_dictionary(
    words: "OrderedDict[str, dict]",
    readings: "OrderedDict[str, list[str]]",
    sentence_candidates: list[SentenceCandidate],
    jmdict_source: SourceRecord,
) -> tuple[dict, dict[str, list[int]]]:
    sentences, entry_indices = _resolve_sentence_links(sentence_candidates, words)
    for key, idxs in entry_indices.items():
        words[key]["e"] = idxs

    meta = {
        "version": "2.0",
        "words": len(words),
        "sentences": len(sentences),
        "description": "Japanese-English dictionary with example sentences",
        "has_frequency": True,
        "frequency_source": "JMdict ke_pri/re_pri priority indicators",
        "jmdict_sha256": jmdict_source.sha256,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    }

    obj = {
        "meta": meta,
        "words": words,
        "readings": readings,
        "sentences": sentences,
    }
    return obj, entry_indices


def _write_grammar_manifest(
    grammar_meta: GrammarMetadataResolved,
    grammar_filename: str,
    grammar_sha256: str,
    grammar_entry_count: int,
) -> bytes:
    manifest = {
        "version": 1,
        "artifacts": [
            {
                "path": grammar_filename,
                "encoding": "gzip",
                "format": "yomitan-v3-term-bank",
                "entries": grammar_entry_count,
                "sha256": grammar_sha256,
            }
        ],
        "source": {
            "title": grammar_meta.title,
            "revision": grammar_meta.revision,
            "format": grammar_meta.format,
            "author": grammar_meta.author,
            "attribution": grammar_meta.attribution,
            "license": grammar_meta.license,
            "metadata_source": grammar_meta.source,
        },
    }
    payload = dumps_compact(manifest, sort_keys=True)
    GRAMMAR_MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)
    GRAMMAR_MANIFEST_OUT.write_bytes(payload + b"\n")
    return payload


def _write_attribution(
    sources: list[SourceRecord],
    grammar_meta: GrammarMetadataResolved,
) -> None:
    src_by_name = {s.name: s for s in sources}
    lines = [
        "# Attribution & Licenses",
        "",
        "This build of the JishoParser data bundle is derived from the following",
        "upstream sources. Each source is reproduced under its own license; the",
        "checksums pinned here identify the exact snapshots consumed.",
        "",
        "## JMdict (English variant)",
        "",
        "- Source: Electronic Dictionary Research and Development Group (EDRDG)",
        "- Snapshot: data/JMdict_e.gz",
        f"- sha256: `{src_by_name['JMdict_e.gz'].sha256}`",
        "- License: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)",
        "- Attribution required; derivative works must be redistributed under",
        "  CC BY-SA 4.0.",
        "",
        "## Tanaka / Tatoeba (JMdict-aligned subset)",
        "",
        "- Source: Tatoeba Project / EDRDG (Tanaka corpus, JMdict-aligned)",
        "- Snapshot: data/sentence_pairs.tsv",
        f"- sha256: `{src_by_name['sentence_pairs.tsv'].sha256}`",
        "- License: Creative Commons Attribution 2.0 France (Tatoeba) / EDRDG terms",
        "- Attribution required.",
        "",
        "## Yomitan grammar bank",
        "",
        f"- Title: {grammar_meta.title}",
        f"- Revision: {grammar_meta.revision}",
        f"- Author: {grammar_meta.author}",
        f"- Attribution: {grammar_meta.attribution}",
        f"- License: {grammar_meta.license}",
        f"- Snapshot: data/grammar.zip",
        f"- sha256: `{src_by_name['grammar.zip'].sha256}`",
        f"- Metadata source: {grammar_meta.source} "
        f"({'read from ZIP' if grammar_meta.source == 'index.json' else 'pipeline grammar_metadata config'})",
        "",
    ]
    ATTRIBUTION_OUT.parent.mkdir(parents=True, exist_ok=True)
    ATTRIBUTION_OUT.write_text("\n".join(lines), encoding="utf-8")


def _write_build_manifest(
    sources: list[SourceRecord],
    grammar_meta: GrammarMetadataResolved,
    outputs: dict[str, dict],
    counts: dict[str, int],
) -> None:
    manifest = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "policy": {
            "examples_per_entry": POLICY.examples_per_entry,
            "best_sentence_rule": POLICY.best_sentence_rule,
            "pos_policy": POLICY.pos_policy,
            "gzip_level": POLICY.gzip_level,
            "keep_all_entries": POLICY.keep_all_entries,
        },
        "sources": [asdict(s) for s in sources],
        "grammar_metadata": {**asdict(grammar_meta)},
        "outputs": outputs,
        "counts": counts,
    }
    BUILD_MANIFEST_OUT.parent.mkdir(parents=True, exist_ok=True)
    BUILD_MANIFEST_OUT.write_bytes(dumps_compact(manifest, sort_keys=True) + b"\n")


def run(
    log: StageLog,
    *,
    words: "OrderedDict[str, dict]",
    readings: "OrderedDict[str, list[str]]",
    sentence_candidates: list[SentenceCandidate],
    grammar_merged: list,
    sources: list[SourceRecord],
    grammar_meta: GrammarMetadataResolved,
) -> dict:
    log.stage("Stage 5 — assemble & package")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # JMdict source record is the one with the matching name.
    jmdict_source = next(s for s in sources if s.name == "JMdict_e.gz")

    dict_obj, entry_indices = _build_dictionary(
        words, readings, sentence_candidates, jmdict_source
    )
    dict_bytes = dumps_compact(dict_obj, sort_keys=False)
    dict_gz = write_gz(DICTIONARY_OUT, dict_bytes, POLICY.gzip_level)
    log.info(f"dictionary.json: {human_bytes(len(dict_bytes))} → "
             f"{human_bytes(len(dict_gz))} gzipped")

    grammar_bytes = dumps_compact(grammar_merged, sort_keys=False)
    grammar_gz = write_gz(GRAMMAR_OUT, grammar_bytes, POLICY.gzip_level)
    log.info(f"grammar.json:    {human_bytes(len(grammar_bytes))} → "
             f"{human_bytes(len(grammar_gz))} gzipped")

    grammar_sha = sha256_bytes(grammar_gz)
    _write_grammar_manifest(
        grammar_meta,
        grammar_filename=GRAMMAR_OUT.name,
        grammar_sha256=grammar_sha,
        grammar_entry_count=len(grammar_merged),
    )
    log.info(f"grammar manifest → {GRAMMAR_MANIFEST_OUT.name}")

    _write_attribution(sources, grammar_meta)
    log.info(f"attribution → {ATTRIBUTION_OUT.name}")

    outputs = {
        "dictionary.json.gz": {
            "path": DICTIONARY_OUT.name,
            "bytes": len(dict_gz),
            "sha256": sha256_bytes(dict_gz),
        },
        "grammar.json.gz": {
            "path": GRAMMAR_OUT.name,
            "bytes": len(grammar_gz),
            "sha256": grammar_sha,
        },
        "grammar-manifest.json": {
            "path": GRAMMAR_MANIFEST_OUT.name,
            "bytes": GRAMMAR_MANIFEST_OUT.stat().st_size,
        },
        "ATTRIBUTION.md": {
            "path": ATTRIBUTION_OUT.name,
            "bytes": ATTRIBUTION_OUT.stat().st_size,
        },
    }
    counts = {
        "words": len(words),
        "readings": len(readings),
        "sentences": len(dict_obj["sentences"]),
        "grammar_entries": len(grammar_merged),
        "entries_with_examples": sum(1 for k in entry_indices if entry_indices[k]),
    }
    _write_build_manifest(sources, grammar_meta, outputs, counts)
    log.info(f"build manifest → {BUILD_MANIFEST_OUT.name}")
    log.done()

    return {
        "dictionary_bytes": dict_bytes,
        "dictionary_gz_bytes": dict_gz,
        "grammar_bytes": grammar_bytes,
        "grammar_gz_bytes": grammar_gz,
        "dict_obj": dict_obj,
        "outputs": outputs,
        "counts": counts,
    }
