"""Stage 1 — vocabulary (``words`` map).

Parses JMdict into a compact map keyed by headword. Each kanji form (``keb``)
of an entry becomes its own key so the morphological tokenizer can look up
any of the orthographic variants it may emit as ``basic_form``; entries with
no ``k_ele`` are keyed by their primary kana reading.

Senses are filtered per key when JMdict carries ``stagk``/``stagr``
restrictions, so a key sees only the senses that actually apply to it. POS
and misc entity codes are normalized to their short JMdict entity names
(e.g. ``n``, ``v5r``, ``abbr``); the parser-side code reads these as
opaque tokens, not display strings.

The ``e`` slot is intentionally left empty here — sentence indices are
assigned during Stage 5 assembly once the global sentence list is frozen.
"""

from __future__ import annotations

import gzip
import io
import re
from collections import OrderedDict
from typing import Iterator
from xml.etree import ElementTree as ET

from .config import JMDICT_PATH, POLICY
from .util import StageLog


_ENTITY_RE = re.compile(r'<!ENTITY\s+(\S+)\s+"([^"]*)">')

# Priority indicators → frequency-score contribution. Values are a heuristic
# proxy for the v1 BCCWJ-derived `f` score, which is not reproducible
# without the original frequency list. The relative ordering is what the
# fallback path cares about.
_PRI_FIXED = {
    "news1": 8, "ichi1": 8, "spec1": 8, "gai1": 8,
    "news2": 4, "ichi2": 4, "spec2": 4, "gai2": 4,
}
_NF_RE = re.compile(r"^nf(\d{2})$")


def _frequency_score(pri_tokens: list[str]) -> int:
    score = 0
    for tok in pri_tokens:
        if tok in _PRI_FIXED:
            score = max(score, _PRI_FIXED[tok])
        else:
            m = _NF_RE.match(tok)
            if m:
                # nf01 = top 500 words → 48; nf48 = bottom → 1
                score = max(score, 49 - int(m.group(1)))
    return score


def _read_blob_and_entity_map(path) -> tuple[bytes, dict[str, str]]:
    with gzip.open(path, "rb") as f:
        blob = f.read()
    # The DTD sits inside `<!DOCTYPE JMdict [ … ]>` at the head of the file.
    head_end = blob.find(b"]>")
    head = blob[: head_end + 2].decode("utf-8", errors="replace")
    desc_to_name: dict[str, str] = {}
    for m in _ENTITY_RE.finditer(head):
        name, desc = m.group(1), m.group(2)
        # First occurrence wins; entity names should map 1:1 with descriptions.
        desc_to_name.setdefault(desc, name)
    return blob, desc_to_name


def _normalize_pos(text: str, desc_to_name: dict[str, str]) -> str:
    """Map JMdict's resolved entity text back to its short entity name.

    ElementTree expands ``&n;`` to ``"noun (common) (futsuumeishi)"``; the
    parser keys off ``"n"``, so we reverse the lookup. Text not found in the
    map (rare; non-entity strings) passes through unchanged.
    """
    if POLICY.pos_policy == "short":
        return desc_to_name.get(text, text)
    return text


def _iter_entries(blob: bytes) -> Iterator[ET.Element]:
    """Stream JMdict entries with bounded memory."""
    ctx = ET.iterparse(io.BytesIO(blob), events=("end",))
    for event, elem in ctx:
        if elem.tag == "entry":
            yield elem
            elem.clear()


def _build_entry_for_key(
    key: str,
    keb_forms: list[str],
    r_elements: list[dict],
    senses: list[dict],
    freq: int,
    is_kana_only: bool,
) -> dict | None:
    # Filter readings by re_restr — a reading restricted to certain kebs only
    # appears in those keys (unless we are a kana-only entry, where r_restr
    # is not applicable to the key itself).
    readings: list[str] = []
    seen_readings: set[str] = set()
    for r in r_elements:
        restr = r.get("restr") or []
        if not is_kana_only and restr and key not in restr:
            continue
        reb = r["reb"]
        if reb in seen_readings:
            continue
        seen_readings.add(reb)
        readings.append(reb)

    # Filter senses by stagk/stagr.
    filtered_senses: list[dict] = []
    for s in senses:
        stagk = s.get("stagk") or []
        stagr = s.get("stagr") or []
        if stagk and key not in stagk:
            continue
        if stagr and not any(r in stagr for r in readings):
            # If a sense is reading-restricted and none of this key's
            # surviving readings are listed, the sense doesn't apply.
            continue
        sense_out: dict = {"pos": s["pos"], "glosses": s["glosses"]}
        if s.get("misc"):
            sense_out["misc"] = s["misc"]
        filtered_senses.append(sense_out)

    if not filtered_senses or not readings:
        return None

    return {
        "r": readings,
        "s": filtered_senses,
        "e": [],
        "f": freq,
    }


def run(log: StageLog) -> "OrderedDict[str, dict]":
    log.stage("Stage 1 — vocabulary (words)")
    blob, desc_to_name = _read_blob_and_entity_map(JMDICT_PATH)
    log.info(f"loaded {len(blob) // 1024} KiB of JMdict XML; "
             f"{len(desc_to_name)} entity definitions")

    words: "OrderedDict[str, dict]" = OrderedDict()
    last_pos: list[str] = []  # JMdict carries POS forward across senses

    n_entries = 0
    n_keys = 0
    n_collisions = 0

    for entry in _iter_entries(blob):
        n_entries += 1
        last_pos = []

        # ---- k_ele ----
        k_forms: list[dict] = []
        for k in entry.findall("k_ele"):
            keb = k.findtext("keb")
            if not keb:
                continue
            k_forms.append({
                "keb": keb,
                "pri": [p.text for p in k.findall("ke_pri") if p.text],
            })

        # ---- r_ele ----
        r_elements: list[dict] = []
        for r in entry.findall("r_ele"):
            reb = r.findtext("reb")
            if not reb:
                continue
            r_elements.append({
                "reb": reb,
                "restr": [t.text for t in r.findall("re_restr") if t.text],
                "pri": [t.text for t in r.findall("re_pri") if t.text],
                "nokanji": r.find("re_nokanji") is not None,
            })

        # ---- sense ----
        senses: list[dict] = []
        for s in entry.findall("sense"):
            pos_elems = [p.text for p in s.findall("pos") if p.text]
            if pos_elems:
                last_pos = [_normalize_pos(p, desc_to_name) for p in pos_elems]
            misc = [_normalize_pos(m.text, desc_to_name)
                    for m in s.findall("misc") if m.text]
            glosses = [g.text for g in s.findall("gloss") if g.text]
            if not glosses:
                continue
            senses.append({
                "pos": list(last_pos),
                "misc": misc,
                "glosses": glosses,
                "stagk": [t.text for t in s.findall("stagk") if t.text],
                "stagr": [t.text for t in s.findall("stagr") if t.text],
            })

        if not senses:
            continue

        # ---- Frequency score: aggregate priority tags from the dominant
        # k_ele (or r_ele for kana-only entries). ----
        if k_forms:
            all_pri = [p for k in k_forms for p in k["pri"]]
        else:
            all_pri = [p for r in r_elements for p in r["pri"]]
        freq = _frequency_score(all_pri)

        # ---- Emit one key per keb; or, for kana-only entries, key by
        # the primary reb. ----
        keys_to_emit: list[tuple[str, bool]]
        if k_forms:
            keys_to_emit = [(k["keb"], False) for k in k_forms]
            keb_list = [k["keb"] for k in k_forms]
        else:
            primary_reb = r_elements[0]["reb"] if r_elements else None
            if primary_reb is None:
                continue
            keys_to_emit = [(primary_reb, True)]
            keb_list = []

        for key, is_kana_only in keys_to_emit:
            built = _build_entry_for_key(
                key, keb_list, r_elements, senses, freq, is_kana_only
            )
            if built is None:
                continue
            if key in words:
                n_collisions += 1
                # Merge: union readings, append senses, max(freq).
                existing = words[key]
                seen_r = set(existing["r"])
                for r in built["r"]:
                    if r not in seen_r:
                        existing["r"].append(r)
                        seen_r.add(r)
                existing["s"].extend(built["s"])
                existing["f"] = max(existing["f"], built["f"])
            else:
                words[key] = built
                n_keys += 1

        if n_entries % 50_000 == 0:
            log.info(f"  parsed {n_entries:,} entries → {n_keys:,} keys")

    log.info(f"parsed {n_entries:,} entries → {n_keys:,} keys "
             f"({n_collisions:,} keb collisions merged)")

    if not POLICY.keep_all_entries:
        # Hook for future filtering policies; default keeps everything.
        pass

    log.done()
    return words
