"""Post-retrain validation gate for the recognizer.

Compares a *candidate* recognizer ONNX against a *baseline* ONNX on the
conditions that matter for the synthetic→real gap diagnosed in
``RECOGNIZER_CHALLENGES.md``:

* ``clean``    — razor-sharp canonical glyphs (the OOD case the old model
                 collapsed on: a crisp, rigidly-drawn character);
* ``freehand`` — razor-sharp + open/crossing corners + stroke connections
                 (the closest synthetic proxy for real handwriting);

and on a broad random class sample (no-regression check). For each condition it
reports overall top-1 + mean self-confidence and a **box/hook confusion-cluster**
line — the headline weakness.

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
from .kanjivg import has_strokes, rasterize_with_perturbation

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

    # rows: (label, charset, condition-name)
    rows = [
        ("random   ", rand_chars, "freehand"),
        ("random   ", rand_chars, "clean"),
        ("BOX      ", cluster_chars["box"], "clean"),
        ("BOX      ", cluster_chars["box"], "freehand"),
        ("HOOK     ", cluster_chars["hook"], "clean"),
        ("HOOK     ", cluster_chars["hook"], "freehand"),
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

    log_fn(
        "\n  PASS heuristic: candidate should RAISE cluster conf on clean & freehand "
        "(the OOD case)\n  and NOT regress random top-1. Note: candidate scores include "
        "the folded temperature,\n  so confidence is calibrated; the real gate is the "
        "in-app handwriting check (RETRAIN_RUNBOOK.md)."
    )
    return 0
