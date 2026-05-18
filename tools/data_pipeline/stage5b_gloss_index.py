"""Stage 5b — English reverse gloss index (vocab + grammar).

Emits ``gloss-index.json.gz`` with two sections:

  - ``vocab``   — postings keyed by normalized English tokens / phrases that
                   resolve into JMdict headwords.
  - ``grammar`` — same shape, resolving into grammar-bank headwords.

Each section has two posting maps:

  - ``u`` — unigram keys ("book", "give", "spite").
  - ``p`` — phrase keys of 2..N tokens ("give up", "give up smoke",
            "as soon possible" — stopwords are dropped at normalization time).

Phrase support is the key affordance for English-input sentence breakdown:
the runtime walks the input greedily, longest-match-first, against the
phrase keys, so "give up running" segments as ``[give up][running]``
rather than ``[give][up][running]``.

Normalization MUST stay aligned with the runtime ``normalizeQuery`` in
``app/lib/engine/glossQuery.ts``. Drift here silently destroys recall.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable

from .config import (
    GLOSS_INDEX_OUT,
    GLOSS_STOPWORDS,
    POLICY,
)
from .util import (
    StageLog,
    dumps_compact,
    human_bytes,
    sha256_bytes,
    write_gz,
)


# Strip parentheticals and bracketed asides — they hint at register/scope,
# not lookup terms. Mirrored in the runtime normalizer.
_PAREN_RE = re.compile(r"[(\[][^)\]]*[)\]]")
_NONWORD_RE = re.compile(r"[^a-z0-9']+")
# Grammar entry meanings often pack multiple translations into one cell
# separated by commas / semicolons. We split on both before tokenizing so a
# phrase like "to give up, to abandon" emits independent n-grams.
_GRAMMAR_GLOSS_SPLIT_RE = re.compile(r"[;,]")


# Grammar-bank section markers — must match the strings produced by the
# Yomitan v3 bank and read by the TS extractGrammarContent.
_GRAMMAR_MEANING_MARKER = "【 Meaning 】"
_GRAMMAR_EXPLANATION_MARKER = "【 Explanation 】"
_GRAMMAR_EXAMPLES_MARKER = "【 Example sentences 】"


def _stem(tok: str) -> str:
    if len(tok) > 4 and tok.endswith("ing"):
        return tok[:-3]
    if len(tok) > 4 and tok.endswith("ed"):
        return tok[:-2]
    if len(tok) > 4 and tok.endswith("ies"):
        return tok[:-3] + "y"
    if len(tok) > 3 and tok.endswith("es") and not tok.endswith("ses"):
        return tok[:-2]
    if len(tok) > 3 and tok.endswith("s") and not tok.endswith("ss"):
        return tok[:-1]
    return tok


def normalize_tokens(text: str) -> list[str]:
    """Lowercase → strip parentheticals → split → drop stopwords/shorts → stem."""
    if not text:
        return []
    s = text.lower()
    s = _PAREN_RE.sub(" ", s)
    s = _NONWORD_RE.sub(" ", s)
    out: list[str] = []
    for raw in s.split():
        tok = raw.strip("'")
        if tok.endswith("'s"):
            tok = tok[:-2]
        if not tok:
            continue
        if tok in GLOSS_STOPWORDS:
            continue
        if len(tok) < POLICY.gloss_min_token_len:
            continue
        if tok.isdigit():
            continue
        stemmed = _stem(tok)
        if not stemmed or stemmed in GLOSS_STOPWORDS:
            continue
        out.append(stemmed)
    return out


def _canonicity_bucket(sense_idx: int, gloss_idx_in_sense: int) -> int:
    """How "canonical" this gloss is as a translation of the indexed token.

    The bucket is the high-order axis of the posting score. Entries whose
    *primary sense's primary gloss* matches the token sit in bucket 10;
    entries whose tenth sense's third gloss happens to match sit in bucket
    1. The bucket sort ensures the canonical translation outranks
    coincidental same-token matches in deep senses regardless of how the
    entry's overall frequency compares — JMdict frequency tags are
    entry-wide, not sense-wide, so without this 打つ#10 "to do" would
    consistently beat 為る#0 "to do" by `f`. With it, the canonical
    sense=0/gloss=0 match wins by an entire bucket.
    """
    if sense_idx == 0:
        if gloss_idx_in_sense == 0:
            return 10
        if gloss_idx_in_sense == 1:
            return 9
        return 8
    if sense_idx == 1:
        return 7 if gloss_idx_in_sense == 0 else 6
    if sense_idx == 2:
        return 5
    if sense_idx == 3:
        return 4
    if sense_idx == 4:
        return 3
    if sense_idx <= 6:
        return 2
    return 1


def _gloss_score(
    *,
    is_solo_token: bool,
    is_head: bool,
    gloss_token_count: int,
    sense_idx: int,
    gloss_idx_in_sense: int = 0,
    phrase_bonus: int = 0,
) -> int:
    """Composite score = canonicity_bucket * 100 + quality (1..99).

    The 100x multiplier guarantees the bucket is the dominant signal; the
    quality term is the within-bucket tiebreaker before frequency takes
    over at sort time. Range: 101..1099.
    """
    quality = 50
    if is_solo_token:
        quality += 30
    if is_head:
        quality += 10
    quality -= min(20, max(0, (gloss_token_count - 1) * 2))
    quality += phrase_bonus
    if quality < 1:
        quality = 1
    elif quality > 99:
        quality = 99
    return _canonicity_bucket(sense_idx, gloss_idx_in_sense) * 100 + quality


def _phrase_quality_bonus(phrase_len: int) -> int:
    """Within-bucket bonus for n-gram matches. Quality is bounded at 99, so
    these bonuses serve as tiebreakers between phrases of different lengths
    inside the same canonicity bucket, not as cross-bucket promoters."""
    # bigram +15, trigram +20, 4-gram +25
    return 10 + (phrase_len - 1) * 5


def _emit_for_gloss(
    toks: list[str],
    sense_idx: int,
    gloss_idx_in_sense: int,
    *,
    phrase_max_len: int,
) -> Iterable[tuple[str, str, int]]:
    """Yield ``(section, key, score)`` for each unigram and phrase derivable
    from one gloss's normalized token list. ``section`` is ``"u"`` or ``"p"``."""
    if not toks:
        return
    gloss_len = len(toks)
    head_tok = toks[0]
    solo = gloss_len == 1

    seen_uni: set[str] = set()
    for tok in toks:
        if tok in seen_uni:
            continue
        seen_uni.add(tok)
        score = _gloss_score(
            is_solo_token=solo and tok == head_tok,
            is_head=tok == head_tok,
            gloss_token_count=gloss_len,
            sense_idx=sense_idx,
            gloss_idx_in_sense=gloss_idx_in_sense,
        )
        yield "u", tok, score

    seen_phr: set[str] = set()
    for n in range(2, min(phrase_max_len, gloss_len) + 1):
        for i in range(0, gloss_len - n + 1):
            window = toks[i : i + n]
            key = " ".join(window)
            if key in seen_phr:
                continue
            seen_phr.add(key)
            score = _gloss_score(
                is_solo_token=False,
                is_head=i == 0,
                gloss_token_count=gloss_len,
                sense_idx=sense_idx,
                gloss_idx_in_sense=gloss_idx_in_sense,
                phrase_bonus=_phrase_quality_bonus(n),
            )
            yield "p", key, score


def _flatten_text(node: object) -> str:
    """Mirror of `grammarContent.ts:flattenText`. Walks a structured-content
    node tree and concatenates all string leaves under any nested ``content``
    fields, in document order."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(_flatten_text(n) for n in node)
    if isinstance(node, dict):
        return _flatten_text(node.get("content"))
    return ""


def _extract_grammar_meanings(glossary: list) -> list[str]:
    """Pull the comma-separated translations from the ``【 Meaning 】`` section
    of a Yomitan grammar entry's structured content. Returns one string per
    direct child of the section — typically a list of short translations."""
    sc_content: list | None = None
    for node in glossary:
        if (
            isinstance(node, dict)
            and node.get("type") == "structured-content"
            and isinstance(node.get("content"), list)
        ):
            sc_content = node["content"]
            break
    if not sc_content:
        return []

    meanings: list[str] = []
    section: str | None = None
    for node in sc_content:
        if isinstance(node, str):
            if _GRAMMAR_MEANING_MARKER in node:
                section = "meaning"
            elif _GRAMMAR_EXPLANATION_MARKER in node or _GRAMMAR_EXAMPLES_MARKER in node:
                section = None
            continue
        if section == "meaning" and isinstance(node, dict):
            text = _flatten_text(node).strip()
            if text:
                meanings.append(text)
    return meanings


def _build_section_postings(
    iter_glosses: Iterable[tuple[str, int, int, str]],
    phrase_max_len: int,
) -> tuple[
    dict[str, dict[tuple[str, int], int]],
    dict[str, dict[tuple[str, int], int]],
]:
    """Collect raw postings for one section (vocab OR grammar) from a stream of
    ``(headword, sense_idx, gloss_idx_in_sense, raw_gloss_text)`` tuples."""
    unigrams: dict[str, dict[tuple[str, int], int]] = defaultdict(dict)
    phrases: dict[str, dict[tuple[str, int], int]] = defaultdict(dict)
    for headword, sense_idx, gloss_idx, gloss in iter_glosses:
        toks = normalize_tokens(gloss)
        if not toks:
            continue
        for section, key, score in _emit_for_gloss(
            toks, sense_idx, gloss_idx, phrase_max_len=phrase_max_len
        ):
            dest = unigrams if section == "u" else phrases
            current = dest[key].get((headword, sense_idx))
            if current is None or score > current:
                dest[key][(headword, sense_idx)] = score
    return unigrams, phrases


def _walk_vocab(words: dict) -> Iterable[tuple[str, int, int, str]]:
    for headword, entry in words.items():
        for sense_idx, sense in enumerate(entry.get("s") or []):
            for gloss_idx, gloss in enumerate(sense.get("glosses") or []):
                yield headword, sense_idx, gloss_idx, gloss


def _walk_grammar(grammar_entries: list) -> Iterable[tuple[str, int, int, str]]:
    for entry in grammar_entries:
        head = entry[0]
        glossary = entry[5]
        meanings = _extract_grammar_meanings(glossary)
        if not meanings:
            continue
        # Each top-level meaning may pack multiple translations behind ``;`` /
        # ``,``. Split so phrase keys don't accidentally bridge translations.
        # sense_idx is held at 0 — grammar entries don't have JMdict-style
        # senses, but keeping the field for posting symmetry simplifies the
        # runtime card builder. gloss_idx_in_sense numbers the comma-split
        # translations so the first one (typically the canonical English
        # rendering) gets the primary-gloss bonus.
        gloss_idx = 0
        for raw in meanings:
            for part in _GRAMMAR_GLOSS_SPLIT_RE.split(raw):
                yield head, 0, gloss_idx, part
                gloss_idx += 1


def _freq_for(headword: str, words: dict, grammar_freq: dict[str, int] | None) -> int:
    if grammar_freq is not None:
        return grammar_freq.get(headword, 0)
    entry = words.get(headword)
    if entry is None:
        return 0
    return entry.get("f") or 0


def _cap_and_sort(
    postings: dict[str, dict[tuple[str, int], int]],
    *,
    words: dict | None,
    grammar_freq: dict[str, int] | None,
    cap: int,
) -> dict[str, list[list]]:
    """Sort each posting list by (score desc, freq desc, headword asc, sense
    asc) and cap at ``cap`` entries."""
    out: dict[str, list[list]] = {}
    for key in sorted(postings.keys()):
        rows: list[tuple[str, int, int]] = [
            (head, sense_idx, sc) for (head, sense_idx), sc in postings[key].items()
        ]
        rows.sort(
            key=lambda row: (
                -row[2],
                -_freq_for(
                    row[0], words or {}, grammar_freq
                ),
                row[0],
                row[1],
            )
        )
        if cap and len(rows) > cap:
            rows = rows[:cap]
        out[key] = [[h, s, sc] for (h, s, sc) in rows]
    return out


def _grammar_frequency_proxy(grammar_entries: list) -> dict[str, int]:
    """Use JLPT level as a frequency proxy for grammar — N5 grammar (entry[7])
    is the most commonly taught, so the most likely to be useful. Maps
    N5→5, N4→4, …, N1→1. Anything else falls back to 0."""
    level_to_score = {"N5": 5, "N4": 4, "N3": 3, "N2": 2, "N1": 1}
    out: dict[str, int] = {}
    for entry in grammar_entries:
        head = entry[0]
        level = entry[7] if len(entry) > 7 else None
        score = level_to_score.get(level, 0) if isinstance(level, str) else 0
        # Multiple entries can share a headword (rare); keep the strongest.
        if score > out.get(head, -1):
            out[head] = score
    return out


def run(log: StageLog, *, words: dict, grammar_entries: list) -> dict:
    log.stage("Stage 5b — gloss reverse index (vocab + grammar)")

    phrase_max = POLICY.gloss_max_phrase_len
    cap = POLICY.gloss_max_postings_per_key

    raw_vocab_uni, raw_vocab_phr = _build_section_postings(
        _walk_vocab(words), phrase_max_len=phrase_max
    )
    log.info(
        f"vocab raw postings: u={len(raw_vocab_uni):,}, p={len(raw_vocab_phr):,}"
    )

    raw_gram_uni, raw_gram_phr = _build_section_postings(
        _walk_grammar(grammar_entries), phrase_max_len=phrase_max
    )
    log.info(
        f"grammar raw postings: u={len(raw_gram_uni):,}, p={len(raw_gram_phr):,}"
    )

    grammar_freq = _grammar_frequency_proxy(grammar_entries)

    vocab_u = _cap_and_sort(raw_vocab_uni, words=words, grammar_freq=None, cap=cap)
    vocab_p = _cap_and_sort(raw_vocab_phr, words=words, grammar_freq=None, cap=cap)
    grammar_u = _cap_and_sort(
        raw_gram_uni, words=None, grammar_freq=grammar_freq, cap=cap
    )
    grammar_p = _cap_and_sort(
        raw_gram_phr, words=None, grammar_freq=grammar_freq, cap=cap
    )

    def _post_count(d: dict[str, list]) -> int:
        return sum(len(v) for v in d.values())

    log.info(
        f"vocab capped: u={_post_count(vocab_u):,} postings across {len(vocab_u):,} keys, "
        f"p={_post_count(vocab_p):,} postings across {len(vocab_p):,} keys"
    )
    log.info(
        f"grammar capped: u={_post_count(grammar_u):,} postings across {len(grammar_u):,} keys, "
        f"p={_post_count(grammar_p):,} postings across {len(grammar_p):,} keys"
    )

    meta = {
        "version": "2.0",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "description": (
            "English-gloss reverse index for EN→JP lookup; "
            "covers JMdict vocab and the Yomitan grammar bank, with phrase "
            "(n-gram) keys for multi-word matching."
        ),
        "policy": {
            "min_token_len": POLICY.gloss_min_token_len,
            "max_postings_per_key": cap,
            "phrase_max_len": phrase_max,
            "stopwords": sorted(GLOSS_STOPWORDS),
            "stemming": "naive-suffix-trim",
        },
        "sections": {
            "vocab": {
                "unigram_keys": len(vocab_u),
                "phrase_keys": len(vocab_p),
                "unigram_postings": _post_count(vocab_u),
                "phrase_postings": _post_count(vocab_p),
            },
            "grammar": {
                "unigram_keys": len(grammar_u),
                "phrase_keys": len(grammar_p),
                "unigram_postings": _post_count(grammar_u),
                "phrase_postings": _post_count(grammar_p),
            },
        },
    }

    obj = {
        "meta": meta,
        "vocab": {"u": vocab_u, "p": vocab_p},
        "grammar": {"u": grammar_u, "p": grammar_p},
    }
    payload = dumps_compact(obj, sort_keys=False)
    gz_bytes = write_gz(GLOSS_INDEX_OUT, payload, POLICY.gzip_level)
    log.info(
        f"gloss-index.json: {human_bytes(len(payload))} → "
        f"{human_bytes(len(gz_bytes))} gzipped"
    )

    log.done()
    return {
        "obj": obj,
        "payload": payload,
        "gz_bytes": gz_bytes,
        "outputs": {
            "gloss-index.json.gz": {
                "path": GLOSS_INDEX_OUT.name,
                "bytes": len(gz_bytes),
                "sha256": sha256_bytes(gz_bytes),
            },
        },
        "counts": {
            "gloss_vocab_unigram_keys": len(vocab_u),
            "gloss_vocab_phrase_keys": len(vocab_p),
            "gloss_vocab_unigram_postings": _post_count(vocab_u),
            "gloss_vocab_phrase_postings": _post_count(vocab_p),
            "gloss_grammar_unigram_keys": len(grammar_u),
            "gloss_grammar_phrase_keys": len(grammar_p),
            "gloss_grammar_unigram_postings": _post_count(grammar_u),
            "gloss_grammar_phrase_postings": _post_count(grammar_p),
        },
    }
