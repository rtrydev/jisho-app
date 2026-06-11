"""Post-retrain validation gate for the recognizer.

Compares a *candidate* recognizer ONNX against a *baseline* ONNX on the
conditions that matter for the synthetic→real gap diagnosed in
``RECOGNIZER_CHALLENGES.md``:

* ``clean``    — razor-sharp canonical glyphs (the OOD case the old model
                 collapsed on: a crisp, rigidly-drawn character);
* ``freehand`` — razor-sharp + open/crossing corners + stroke connections
                 (the closest synthetic proxy for real handwriting);
* ``print`` / ``print-bold`` — font-rendered filled glyphs (the camera-mode
                 input; ``print-bold`` is the bold-sans slice photo mode
                 struggles with). These rows also report the **camera gate**
                 statistic: the share of samples whose top-12 softmax mass
                 clears ``MIN_GLYPH_MASS`` (0.02) — below it the camera path
                 silently drops the cell (app/lib/handwriting/glyphConfidence.ts),
                 so a low gate%% means characters vanish, not just misread;

and on a broad random class sample (no-regression check). For each condition it
reports overall top-1 + mean self-confidence and a **box/hook confusion-cluster**
line — the headline weakness. The print conditions add a per-font-face table
(worst faces first) attributing the letterform gap. Print rows need the font
pack: ``python -m tools.handwriting_ocr fetch-fonts``.

Unlike ``eval`` (which is a head-to-head between two PyTorch ``.pt``
checkpoints), this works on the **shipped ONNX artifacts** — so it needs only
the repo + venv + the two ``.onnx`` files, runs on any machine, and measures
exactly what the browser will load (int8-quantized, temperature-folded). It is
the automated gate in ``RETRAIN_RUNBOOK.md``.

    python -m tools.handwriting_ocr validate \
        --baseline .handwriting-work/kanji-recognizer.baseline.onnx \
        --candidate public/data/kanji-recognizer.onnx

Either model may be omitted to get an absolute single-model report.
"""
from __future__ import annotations

import json
import random
from dataclasses import replace
from pathlib import Path

import numpy as np

from .augment import augment
from .config import CLASSES_OUT, MODEL_OUT, SynthesisPolicy
from .eval import CONFUSION_CLUSTERS, _conditions
from .fonts import discover_japanese_fonts, filter_font_faces, rasterize_with_font
from .kanjivg import has_strokes, rasterize_with_perturbation

# Camera-mode text-presence floor — keep in sync with MIN_GLYPH_MASS in
# app/lib/handwriting/glyphConfidence.ts. A cell whose top-K softmax mass is
# below this is silently discarded by the camera path ("no character here").
GLYPH_MASS_FLOOR = 0.02
GLYPH_MASS_K = 12

# Default baseline: where RETRAIN_RUNBOOK.md says to stash the pre-retrain model.
DEFAULT_BASELINE = Path(".handwriting-work") / "kanji-recognizer.baseline.onnx"


def _load_classes() -> list[str]:
    return json.loads(Path(CLASSES_OUT).read_text(encoding="utf-8"))["classes"]


def _softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


class _OnnxModel:
    """Thin ORT wrapper; renders/scores at the model's own input resolution."""

    def __init__(self, path: Path) -> None:
        import onnxruntime as ort

        self.path = path
        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.iname = self.sess.get_inputs()[0].name
        self.oname = self.sess.get_outputs()[0].name
        shp = self.sess.get_inputs()[0].shape
        # [batch, 1, H, W] — trailing dim is the spatial size.
        self.size = shp[-1] if isinstance(shp[-1], int) else 96
        self.channels = shp[1] if isinstance(shp[1], int) else 1

    def prob_vec(self, arr: np.ndarray) -> np.ndarray:
        logits = self.sess.run([self.oname], {self.iname: arr[None, None]})[0][0]
        return _softmax(logits)


def _render(ch: str, policy: SynthesisPolicy, size: int, seed: int) -> np.ndarray | None:
    rng = random.Random(seed)
    pol = replace(policy, image_size=size)
    arr = rasterize_with_perturbation(ch, size, rng=rng, policy=pol)
    if arr is None:
        return None
    return augment(arr, rng, pol).astype(np.float32)


def _score(
    model: _OnnxModel,
    classes: list[str],
    chars: list[str],
    policy: SynthesisPolicy,
    *,
    n: int,
) -> tuple[float, float, int]:
    """(top-1, mean self-confidence, count) for a model over ``chars``.

    Confusions into *any* of the model's classes count as misses (the argmax is
    over the full softmax, not just ``chars``). Seeds are per (char, sample)
    only, so two models see the same character + same geometric skew, each
    rendered at its own resolution — directly comparable across input sizes."""
    idx = {c: i for i, c in enumerate(classes)}
    confs: list[float] = []
    hits = 0
    total = 0
    for ch in chars:
        gi = idx.get(ch)
        if gi is None or not has_strokes(ch):
            continue
        for s in range(n):
            arr = _render(ch, policy, model.size, seed=(gi * 1009 + s))
            if arr is None:
                continue
            p = model.prob_vec(arr)
            # A baseline trained before the kana expansion has fewer outputs than
            # the current class list has entries; its kana indices don't exist.
            # Skip them so a kanji-only baseline can still be compared on kanji
            # (and KANA-* rows simply report the candidate alone).
            if gi >= p.shape[0]:
                break
            confs.append(float(p[gi]))
            hits += int(int(p.argmax()) == gi)
            total += 1
    return (
        (hits / total if total else 0.0),
        (float(np.mean(confs)) if confs else 0.0),
        total,
    )


def _fmt(a: tuple[float, float, int]) -> str:
    return f"top1 {a[0]*100:5.1f}%  conf {a[1]*100:5.1f}%"


# ---------- print (photo-mode letterform) rows --------------------------- #

FontFace = tuple[Path, int]


def _face_label(path: Path, idx: int) -> str:
    return f"{path.stem}#{idx}" if path.suffix.lower() == ".ttc" else path.stem


def _char_seed(ch: str, s: int) -> int:
    # Stable across processes (hash(str) is salted per interpreter run).
    return 0x5EED ^ (ord(ch) * 2654435761) ^ (s * 97)


def _render_print(
    ch: str,
    policy: SynthesisPolicy,
    size: int,
    seed: int,
    faces: list[FontFace],
) -> np.ndarray | None:
    """One font-rendered sample: deterministic face pick + render + augment.

    ``None`` when the picked face lacks the glyph (renders empty) — skipped
    rather than counted as a miss, mirroring the stroke path's ``None``."""
    rng = random.Random(seed)
    pol = replace(policy, image_size=size)
    path, idx = faces[rng.randrange(len(faces))]
    arr = rasterize_with_font(ch, path, size, index=idx, rng=rng, policy=pol)
    if arr.max() <= 0:
        return None
    return augment(arr, rng, pol).astype(np.float32)


def _score_print(
    model: _OnnxModel,
    classes: list[str],
    chars: list[str],
    policy: SynthesisPolicy,
    faces: list[FontFace],
    *,
    n: int,
) -> tuple[float, float, float, int]:
    """(top-1, mean self-confidence, camera-gate pass rate, count) on font
    renders. gate = top-``GLYPH_MASS_K`` softmax mass ≥ ``GLYPH_MASS_FLOOR`` —
    the camera path's keep/drop decision; ``1 - gate`` is the share of real
    characters photo mode silently deletes (worse than a misread)."""
    idx = {c: i for i, c in enumerate(classes)}
    confs: list[float] = []
    hits = gate = total = 0
    for ch in chars:
        gi = idx.get(ch)
        if gi is None:
            continue
        for s in range(n):
            arr = _render_print(ch, policy, model.size, _char_seed(ch, s), faces)
            if arr is None:
                continue
            p = model.prob_vec(arr)
            if gi >= p.shape[0]:
                break
            confs.append(float(p[gi]))
            hits += int(int(p.argmax()) == gi)
            topk = np.partition(p, -GLYPH_MASS_K)[-GLYPH_MASS_K:]
            gate += int(float(topk.sum()) >= GLYPH_MASS_FLOOR)
            total += 1
    return (
        (hits / total if total else 0.0),
        (float(np.mean(confs)) if confs else 0.0),
        (gate / total if total else 0.0),
        total,
    )


def _fmt_print(a: tuple[float, float, float, int]) -> str:
    return f"top1 {a[0]*100:5.1f}%  conf {a[1]*100:5.1f}%  gate {a[2]*100:5.1f}%"


def run(
    *,
    baseline: str | None = None,
    candidate: str | None = None,
    samples: int = 12,
    num_random: int = 120,
    log_fn=print,
) -> int:
    classes = _load_classes()

    # Resolve models. Candidate defaults to the shipped artifact; baseline to
    # the runbook's stash. Each is optional → single-model absolute report.
    models: dict[str, _OnnxModel] = {}
    cand_path = Path(candidate) if candidate else MODEL_OUT
    base_path = Path(baseline) if baseline else DEFAULT_BASELINE
    if cand_path.exists():
        models["candidate"] = _OnnxModel(cand_path)
    if base_path.exists():
        models["baseline"] = _OnnxModel(base_path)
    if not models:
        log_fn(
            f"!! neither model found (candidate={cand_path}, baseline={base_path}).\n"
            "   Train + export first, and stash the pre-retrain model per RETRAIN_RUNBOOK.md."
        )
        return 1

    for name, m in models.items():
        if m.channels != 1:
            log_fn(
                f"!! {name} expects {m.channels} input channels; this validator renders "
                "1-channel ink only. A multi-channel model needs the stroke-order renderer."
            )
            return 1

    conds = _conditions()
    rng = random.Random(20260529)
    rand_pool = [c for c in classes if has_strokes(c)]
    rand_chars = rng.sample(rand_pool, min(num_random, len(rand_pool)))
    cluster_chars = {k: list(v) for k, v in CONFUSION_CLUSTERS.items()}

    order = [n for n in ("baseline", "candidate") if n in models]
    for name in order:
        log_fn(f"  {name:>9}: {models[name].path}  (input {models[name].size}px)")
    log_fn(f"  samples/char={samples}  random classes={len(rand_chars)}\n")

    # rows: (label, charset, condition-name). The KANA-* rows are no-ops on a
    # kanji-only model (their kana chars aren't classes → skipped by _score), and
    # light up once a kana-inclusive model is loaded. KANA-X mixes kana with the
    # kanji they collide with, so even the old model reports the kanji half.
    rows = [
        ("random   ", rand_chars, "freehand"),
        ("random   ", rand_chars, "clean"),
        ("BOX      ", cluster_chars["box"], "clean"),
        ("BOX      ", cluster_chars["box"], "freehand"),
        ("HOOK     ", cluster_chars["hook"], "clean"),
        ("HOOK     ", cluster_chars["hook"], "freehand"),
        ("KANA-X   ", cluster_chars["kana_xscript"], "clean"),
        ("KANA-X   ", cluster_chars["kana_xscript"], "freehand"),
        ("KANA-DAK ", cluster_chars["kana_dakuten"], "clean"),
        ("KANA-LOOP", cluster_chars["kana_loop"], "freehand"),
        ("KANA-SHI ", cluster_chars["kana_shi"], "freehand"),
    ]
    for label, chars, cond in rows:
        pol = conds[cond]
        parts = []
        scores: dict[str, tuple[float, float, int]] = {}
        for name in order:
            scores[name] = _score(models[name], classes, chars, pol, n=samples)
            parts.append(f"{name}: {_fmt(scores[name])}")
        delta = ""
        if "baseline" in scores and "candidate" in scores:
            dc = (scores["candidate"][1] - scores["baseline"][1]) * 100
            dt = (scores["candidate"][0] - scores["baseline"][0]) * 100
            delta = f"   Δ top1 {dt:+5.1f}  Δ conf {dc:+5.1f}"
        log_fn(f"  {label} [{cond:>8}] | " + "   ".join(parts) + delta)

    # Photo-mode letterform rows: font renders instead of KanjiVG strokes, on
    # the same random char sample. `gate` is the camera keep/drop pass rate
    # (see module docstring) — low gate = photo mode silently drops characters.
    # PRINT-PH forces the measured photo killers (low-res + dim ink) onto the
    # bold faces — the row the photo-appearance retrain knobs must raise.
    for label, cond in (
        ("PRINT    ", "print"),
        ("PRINT-B  ", "print-bold"),
        ("PRINT-PH ", "print-photo"),
    ):
        pol = conds[cond]
        faces = list(filter_font_faces(discover_japanese_fonts(), pol.font_stem_allow))
        if not faces:
            log_fn(
                f"  {label} [{cond:>8}] | skipped — no fonts matched "
                f"(filter={list(pol.font_stem_allow) or 'none'}); "
                "run `python -m tools.handwriting_ocr fetch-fonts`."
            )
            continue
        parts = []
        pscores: dict[str, tuple[float, float, float, int]] = {}
        for name in order:
            pscores[name] = _score_print(
                models[name], classes, rand_chars, pol, faces, n=samples
            )
            parts.append(f"{name}: {_fmt_print(pscores[name])}")
        delta = ""
        if "baseline" in pscores and "candidate" in pscores:
            dt = (pscores["candidate"][0] - pscores["baseline"][0]) * 100
            dg = (pscores["candidate"][2] - pscores["baseline"][2]) * 100
            delta = f"   Δ top1 {dt:+5.1f}  Δ gate {dg:+5.1f}"
        log_fn(f"  {label} [{cond:>8}] | " + "   ".join(parts) + delta)

    # Per-face attribution under [print]: which letterforms carry the gap.
    pol = conds["print"]
    faces = list(filter_font_faces(discover_japanese_fonts(), pol.font_stem_allow))
    if faces:
        face_chars = rand_chars[:48]
        face_samples = min(2, samples)
        log_fn(
            f"\n  per-face under [print] (worst first; {len(faces)} faces, "
            f"{len(face_chars)} chars × {face_samples}):"
        )
        face_rows = []
        for face in faces:
            per = {
                name: _score_print(
                    models[name], classes, face_chars, pol, [face], n=face_samples
                )
                for name in order
            }
            face_rows.append((_face_label(*face), per))
        face_rows.sort(key=lambda r: r[1][order[-1]][0])
        for flabel, per in face_rows:
            parts = [
                f"{name}: top1 {per[name][0]*100:5.1f}% gate {per[name][2]*100:3.0f}%"
                for name in order
            ]
            log_fn(
                f"    {flabel:<36} " + "   ".join(parts) + f"  (n={per[order[-1]][3]})"
            )

    log_fn(
        "\n  PASS heuristic: candidate should RAISE cluster conf on clean & freehand "
        "(the OOD case)\n  and NOT regress random top-1. PRINT rows: top-1 is the "
        "photo-mode letterform gap;\n  gate% below ~100 means photo mode silently "
        "drops that share of real characters.\n  Note: candidate scores include "
        "the folded temperature,\n  so confidence is calibrated; the real gate is the "
        "in-app handwriting check (RETRAIN_RUNBOOK.md)."
    )
    return 0
