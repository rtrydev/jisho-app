"""Class-set extraction.

Mines the kanji that actually appear in JMdict headwords, intersects with
JIS X 0208 L1+L2 (a stable Unicode-defined ceiling), and emits the ordered
class list that the model's softmax output maps to. **Index in the list =
class index in the model.**

JIS X 0208 membership is tested by attempting to encode each character to
``shift_jis`` — the standard library knows the table, so we don't carry our
own. CJK Extension A/B characters fail this test and are dropped (they tend
to be rare/obsolete characters with no practical handwriting use case).

Determinism: the output is sorted by ``(-occurrences, codepoint)``, so an
identical JMdict snapshot always produces an identical class list — the
class index stays stable across retraining runs.
"""

from __future__ import annotations

import gzip
import io
import json
from collections import Counter
from typing import Iterator
from xml.etree import ElementTree as ET

from .config import CLASS_POLICY, CLASSES_OUT, JMDICT_PATH


# CJK Unified Ideographs (the primary block) plus the CJK Compatibility
# Ideographs block. Extensions A/B/… are intentionally excluded — JIS X 0208
# would drop them anyway under the policy default.
_CJK_RANGES: tuple[tuple[int, int], ...] = (
    (0x4E00, 0x9FFF),
    (0xF900, 0xFAFF),
)


def _is_cjk_ideograph(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in _CJK_RANGES)


def _in_jis_x_0208(ch: str) -> bool:
    """True iff ``ch`` is encodable as JIS X 0208 (via Shift-JIS).

    Shift-JIS encodes exactly JIS X 0208 plus the JIS X 0201 half-width
    subset; for a CJK ideograph the encode succeeds iff the character is in
    JIS X 0208 L1+L2.
    """
    try:
        ch.encode("shift_jis")
        return True
    except UnicodeEncodeError:
        return False


def _iter_kebs(jmdict_path) -> Iterator[str]:
    """Stream every ``<keb>`` text in JMdict with bounded memory."""
    with gzip.open(jmdict_path, "rb") as f:
        blob = f.read()
    ctx = ET.iterparse(io.BytesIO(blob), events=("end",))
    for _, elem in ctx:
        if elem.tag == "keb" and elem.text:
            yield elem.text
        if elem.tag == "entry":
            elem.clear()


def _count_kanji_occurrences() -> Counter[str]:
    """Count distinct headwords each kanji character appears in."""
    counts: Counter[str] = Counter()
    n_kebs = 0
    for keb in _iter_kebs(JMDICT_PATH):
        n_kebs += 1
        # A char is counted once per headword; multiple occurrences of 木 in
        # 木々 don't multiply-count.
        for ch in set(keb):
            if _is_cjk_ideograph(ch):
                counts[ch] += 1
    return counts


def extract_classes() -> list[str]:
    """Run the full extraction; return the ordered class list."""
    if not JMDICT_PATH.exists():
        raise FileNotFoundError(
            f"JMdict not found at {JMDICT_PATH}. Place it there per "
            f"data/README.md before running 'classes'."
        )
    counts = _count_kanji_occurrences()

    candidates: list[tuple[str, int]] = [
        (ch, n)
        for ch, n in counts.items()
        if n >= CLASS_POLICY.min_jmdict_occurrences
    ]
    if CLASS_POLICY.restrict_to_jis_x_0208:
        candidates = [(ch, n) for ch, n in candidates if _in_jis_x_0208(ch)]

    # Sort by (-count, codepoint) → deterministic within the frequency tier.
    candidates.sort(key=lambda x: (-x[1], ord(x[0])))
    if len(candidates) > CLASS_POLICY.max_classes:
        candidates = candidates[: CLASS_POLICY.max_classes]

    return [ch for ch, _ in candidates]


def run(*, log_fn=print) -> list[str]:
    """CLI entry: extract, write to disk, print a small summary."""
    classes = extract_classes()
    CLASSES_OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "kanji-classes/v1",
        "policy": {
            "restrict_to_jis_x_0208": CLASS_POLICY.restrict_to_jis_x_0208,
            "min_jmdict_occurrences": CLASS_POLICY.min_jmdict_occurrences,
            "max_classes": CLASS_POLICY.max_classes,
        },
        "count": len(classes),
        "classes": classes,
    }
    CLASSES_OUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    log_fn(
        f"wrote {len(classes):,} classes → "
        f"{CLASSES_OUT.relative_to(CLASSES_OUT.parents[2])}"
    )
    return classes


def load_classes() -> list[str]:
    """Read the on-disk class list. Used by ``train`` / ``export``."""
    if not CLASSES_OUT.exists():
        raise FileNotFoundError(
            f"{CLASSES_OUT} not found. Run "
            f"'python -m tools.handwriting_ocr classes' first."
        )
    payload = json.loads(CLASSES_OUT.read_text(encoding="utf-8"))
    return list(payload["classes"])
