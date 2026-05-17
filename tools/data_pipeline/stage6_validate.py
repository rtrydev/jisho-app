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

import fugashi
import ipadic

from .config import (
    DICTIONARY_OUT,
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


def run(log: StageLog, dict_obj: dict, grammar_merged: list) -> None:
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

    log.done()
