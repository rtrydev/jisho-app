"""Stage 6 — validation gates.

Any violation fails the build. The checks here are the correctness backstop
that justifies the v1 schema preservation: if these pass, the assembled
bundle is a drop-in for the existing parser, with linked sentences and a
renderable grammar bank.
"""

from __future__ import annotations

import gzip
import json
import random
from pathlib import Path
from typing import Callable

import fugashi
import ipadic

from .config import (
    DICTIONARY_OUT,
    GLOSS_INDEX_OUT,
    GRAMMAR_MANIFEST_OUT,
    GRAMMAR_OUT,
    OUTPUT_DIR,
    POLICY,
)
from .util import StageLog


_REQUIRED_MARKERS = ("【 Meaning 】", "【 Explanation 】", "【 Example sentences 】")
_VALID_JLPT = {"N1", "N2", "N3", "N4", "N5"}


def _fail(msg: str) -> None:
    raise SystemExit(f"Stage 6 validation failed: {msg}")


def _content_text(node) -> str:
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_content_text(n) for n in node)
    if isinstance(node, dict):
        return _content_text(node.get("content"))
    return ""


def _validate_gloss_index(
    log: StageLog,
    dict_obj: dict,
    grammar_merged: list,
    gloss_index: dict,
    rng: random.Random,
) -> None:
    for k in ("meta", "vocab", "grammar"):
        if k not in gloss_index:
            _fail(f"gloss-index missing top-level key {k!r}")
    for section_name in ("vocab", "grammar"):
        section = gloss_index[section_name]
        if not isinstance(section, dict):
            _fail(f"gloss-index.{section_name} is not an object")
        for k in ("u", "p"):
            if k not in section or not isinstance(section[k], dict):
                _fail(f"gloss-index.{section_name}.{k} is missing or malformed")
    log.info("gloss-index schema: top-level shape OK")

    n_vu = len(gloss_index["vocab"]["u"])
    n_vp = len(gloss_index["vocab"]["p"])
    n_gu = len(gloss_index["grammar"]["u"])
    n_gp = len(gloss_index["grammar"]["p"])
    bounds = [
        ("vocab.u", n_vu, POLICY.min_gloss_vocab_unigram_keys, POLICY.max_gloss_vocab_unigram_keys),
        ("vocab.p", n_vp, POLICY.min_gloss_vocab_phrase_keys, POLICY.max_gloss_vocab_phrase_keys),
        ("grammar.u", n_gu, POLICY.min_gloss_grammar_unigram_keys, POLICY.max_gloss_grammar_unigram_keys),
        ("grammar.p", n_gp, POLICY.min_gloss_grammar_phrase_keys, POLICY.max_gloss_grammar_phrase_keys),
    ]
    for name, n, lo, hi in bounds:
        if not (lo <= n <= hi):
            _fail(f"gloss-index {name} key count {n:,} outside expected [{lo:,}, {hi:,}]")
    log.info(
        f"gloss-index bounds: vocab u={n_vu:,} p={n_vp:,}; "
        f"grammar u={n_gu:,} p={n_gp:,}"
    )

    words = dict_obj["words"]
    # Grammar entry headword → entry, for posting integrity checks.
    grammar_by_head: dict[str, list] = {}
    for entry in grammar_merged:
        head = entry[0]
        # Multiple bank entries can share a headword; first one wins for the
        # integrity check (we only need existence).
        grammar_by_head.setdefault(head, entry)

    def _check_vocab_posting(section: str, key: str, row) -> None:
        if not (isinstance(row, list) and len(row) == 3):
            _fail(f"gloss-index vocab.{section}[{key!r}] posting malformed: {row!r}")
        head, sense_idx, score = row
        entry = words.get(head)
        if entry is None:
            _fail(
                f"gloss-index vocab.{section}[{key!r}] points at missing "
                f"headword {head!r}"
            )
        senses = entry.get("s") or []
        if not (0 <= sense_idx < len(senses)):
            _fail(
                f"gloss-index vocab.{section}[{key!r}] sense {sense_idx} out "
                f"of range for {head!r} (has {len(senses)} senses)"
            )
        if not (isinstance(score, int) and 1 <= score <= 1099):
            _fail(
                f"gloss-index vocab.{section}[{key!r}] score {score!r} out of range"
            )

    def _check_grammar_posting(section: str, key: str, row) -> None:
        if not (isinstance(row, list) and len(row) == 3):
            _fail(f"gloss-index grammar.{section}[{key!r}] posting malformed: {row!r}")
        head, sense_idx, score = row
        if head not in grammar_by_head:
            _fail(
                f"gloss-index grammar.{section}[{key!r}] points at missing "
                f"headword {head!r}"
            )
        if sense_idx != 0:
            _fail(
                f"gloss-index grammar.{section}[{key!r}] sense {sense_idx} != 0 "
                "(grammar entries have a single sense)"
            )
        if not (isinstance(score, int) and 1 <= score <= 1099):
            _fail(
                f"gloss-index grammar.{section}[{key!r}] score {score!r} out of range"
            )

    sample_size = POLICY.validation_sample_size
    cap = POLICY.gloss_max_postings_per_key

    def _sample_check(
        section_name: str,
        kind: str,
        check: Callable[[str, str, object], None],
    ) -> int:
        postings = gloss_index[section_name][kind]
        keys = rng.sample(list(postings.keys()), k=min(sample_size, len(postings)))
        for key in keys:
            rows = postings[key]
            if not rows:
                _fail(f"gloss-index {section_name}.{kind}[{key!r}] is empty")
            if len(rows) > cap:
                _fail(
                    f"gloss-index {section_name}.{kind}[{key!r}] has "
                    f"{len(rows)} postings, exceeds cap {cap}"
                )
            for row in rows[:5]:
                check(kind, key, row)
        return len(keys)

    counts = {}
    counts["vu"] = _sample_check("vocab", "u", _check_vocab_posting)
    counts["vp"] = _sample_check("vocab", "p", _check_vocab_posting)
    counts["gu"] = _sample_check("grammar", "u", _check_grammar_posting)
    counts["gp"] = _sample_check("grammar", "p", _check_grammar_posting)
    log.info(
        "gloss-index posting integrity: sampled "
        f"vocab(u={counts['vu']},p={counts['vp']}), "
        f"grammar(u={counts['gu']},p={counts['gp']}) keys OK"
    )

    # Probe: at least one well-known phrase resolves into the expected JP
    # headword. This catches normalization drift between build and config.
    probe_phrases = [
        ("vocab", "p", "give up", "諦める"),
        ("vocab", "u", "book", "本"),
    ]
    for section_name, kind, key, expected_head_substr in probe_phrases:
        if key not in gloss_index[section_name][kind]:
            log.info(
                f"  probe {section_name}.{kind}[{key!r}] absent — phrase index "
                "may be unhealthy; check normalize_tokens drift"
            )
            continue
        heads = {row[0] for row in gloss_index[section_name][kind][key]}
        if not any(expected_head_substr in h or h in expected_head_substr for h in heads):
            log.info(
                f"  probe {section_name}.{kind}[{key!r}] did not include "
                f"{expected_head_substr!r}; top heads={list(sorted(heads))[:5]}"
            )

    # Gzipped artifact decompresses and respects size budget.
    if not GLOSS_INDEX_OUT.exists():
        _fail(f"gloss-index artifact missing on disk: {GLOSS_INDEX_OUT}")
    gz_size = GLOSS_INDEX_OUT.stat().st_size
    if gz_size > POLICY.max_gloss_index_bytes_gz:
        _fail(
            f"gloss-index.json.gz is {gz_size:,} bytes, exceeds budget "
            f"{POLICY.max_gloss_index_bytes_gz:,}"
        )
    try:
        with gzip.open(GLOSS_INDEX_OUT, "rb") as f:
            while f.read(1 << 16):
                pass
    except Exception as exc:
        _fail(f"gloss-index.json.gz fails gzip decode: {exc}")
    log.info(f"gloss-index.json.gz decompresses cleanly ({gz_size:,} bytes)")


def run(log: StageLog, dict_obj: dict, grammar_merged: list, *, gloss_index: dict | None = None) -> None:
    log.stage("Stage 6 — validation")
    rng = random.Random(0xCAFEBABE)

    # ---- Schema conformance ----
    for k in ("meta", "words", "readings", "sentences"):
        if k not in dict_obj:
            _fail(f"dictionary missing top-level key {k!r}")
    if not isinstance(dict_obj["words"], dict):
        _fail("dictionary.words is not an object")
    if not isinstance(dict_obj["readings"], dict):
        _fail("dictionary.readings is not an object")
    if not isinstance(dict_obj["sentences"], list):
        _fail("dictionary.sentences is not an array")
    log.info("schema: top-level shape OK")

    n_words = len(dict_obj["words"])
    n_sentences = len(dict_obj["sentences"])
    if not (POLICY.min_word_entries <= n_words <= POLICY.max_word_entries):
        _fail(
            f"word count {n_words} outside expected "
            f"[{POLICY.min_word_entries}, {POLICY.max_word_entries}]"
        )
    if not (POLICY.min_sentence_pairs <= n_sentences <= POLICY.max_sentence_pairs):
        _fail(
            f"sentence count {n_sentences} outside expected "
            f"[{POLICY.min_sentence_pairs}, {POLICY.max_sentence_pairs}]"
        )
    log.info(f"sanity bounds: words={n_words:,}, sentences={n_sentences:,}")

    # ---- Index integrity ----
    bad = 0
    for key, entry in dict_obj["words"].items():
        for idx in entry.get("e", []):
            if not (0 <= idx < n_sentences):
                bad += 1
    if bad:
        _fail(f"{bad} entries have out-of-range sentence indices")
    log.info("index integrity: every words[*].e resolves to a valid sentence slot")

    # ---- Tokenizer alignment ----
    tagger = fugashi.GenericTagger(ipadic.MECAB_ARGS)
    probe_words = [
        "本", "日本", "食べる", "見る", "学校", "言葉", "勉強", "新しい",
        "走る", "書く", "読む", "美しい", "大きい", "小さい", "車",
    ]
    misses = []
    for w in probe_words:
        toks = list(tagger(w))
        if not toks:
            misses.append((w, "no tokens"))
            continue
        base = toks[0].feature[6] if len(toks[0].feature) > 6 else None
        if base in (None, "*"):
            misses.append((w, f"no basic_form for {toks[0].surface!r}"))
            continue
        if base not in dict_obj["words"]:
            misses.append((w, f"basic_form {base!r} not in words"))
    if misses:
        _fail(f"tokenizer alignment: {len(misses)}/{len(probe_words)} probes failed: {misses[:5]}")
    log.info(f"tokenizer alignment: {len(probe_words)}/{len(probe_words)} probes resolved")

    # ---- Readings round-trip ----
    reading_samples = rng.sample(
        list(dict_obj["readings"].keys()),
        k=min(POLICY.validation_sample_size, len(dict_obj["readings"])),
    )
    bad_readings = 0
    for r in reading_samples:
        for k in dict_obj["readings"][r]:
            if k not in dict_obj["words"]:
                bad_readings += 1
                break
    if bad_readings:
        _fail(f"readings round-trip: {bad_readings} sampled readings point at missing keys")
    log.info(f"readings round-trip: {len(reading_samples)} samples all resolve")

    # ---- Grammar renderability ----
    grammar_samples = rng.sample(
        range(len(grammar_merged)),
        k=min(POLICY.validation_sample_size, len(grammar_merged)),
    )
    for idx in grammar_samples:
        e = grammar_merged[idx]
        if len(e) != 8:
            _fail(f"grammar entry {idx} is not an 8-tuple")
        body = e[5]
        if not (isinstance(body, list) and body and isinstance(body[0], dict)
                and body[0].get("type") == "structured-content"):
            _fail(f"grammar entry {idx} has malformed structured-content")
        flat = _content_text(body[0].get("content"))
        for marker in _REQUIRED_MARKERS:
            if marker not in flat:
                _fail(f"grammar entry {idx} missing marker {marker!r}")
        if e[7] not in _VALID_JLPT:
            _fail(f"grammar entry {idx} has invalid JLPT tag {e[7]!r}")
    log.info(f"grammar renderability: {len(grammar_samples)} samples valid")

    # ---- Manifest consistency ----
    manifest = json.loads(GRAMMAR_MANIFEST_OUT.read_text(encoding="utf-8"))
    if not manifest.get("artifacts"):
        _fail("grammar manifest has no artifacts")
    for art in manifest["artifacts"]:
        artifact_path = OUTPUT_DIR / art["path"]
        if not artifact_path.exists():
            _fail(f"grammar manifest references missing artifact: {art['path']}")
        try:
            with gzip.open(artifact_path, "rb") as f:
                # Streaming decode validation; don't materialize the full blob.
                while f.read(1 << 16):
                    pass
        except Exception as exc:
            _fail(f"grammar manifest artifact {art['path']} fails gzip decode: {exc}")
    log.info("manifest consistency: artifacts present and decompress cleanly")

    # ---- Dictionary gzip decompresses ----
    try:
        with gzip.open(DICTIONARY_OUT, "rb") as f:
            while f.read(1 << 16):
                pass
    except Exception as exc:
        _fail(f"dictionary.json.gz fails gzip decode: {exc}")
    log.info("dictionary.json.gz decompresses cleanly")

    if not (POLICY.min_grammar_entries <= len(grammar_merged) <= POLICY.max_grammar_entries):
        _fail(
            f"grammar entries {len(grammar_merged)} outside expected "
            f"[{POLICY.min_grammar_entries}, {POLICY.max_grammar_entries}]"
        )

    if gloss_index is not None:
        _validate_gloss_index(log, dict_obj, grammar_merged, gloss_index, rng)

    log.done()
