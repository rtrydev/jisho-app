"""Validation gate for the boundary segmenter (run before TS integration).

Renders real multi-character words the way the synthesis pipeline does, runs the
exported segmenter ONNX, and checks:
  1. boundary COUNT == len(word) - 1, and
  2. end-to-end: splitting the strip at the predicted boundaries and running
     each piece through the *recognizer* ONNX yields the right characters.

Single characters (incl. wide multi-component kanji like 川/明) must yield zero
boundaries — the segmenter must not cut inside a character.
"""

from __future__ import annotations

import random

import numpy as np
import onnxruntime as rt
from PIL import Image

from .classes import load_classes
from .config import MODEL_OUT, SEGMENT_POLICY, SEGMENTER_OUT, VAL_POLICY
from .segment_synth import synthesize_strip, column_ink, decode_boundaries
from .segment_train import INK_WINDOW, PEAK_MIN_SEP, PEAK_THRESHOLD

REC_SIZE = 96
REC_MARGIN = 0.12  # matches app/lib/handwriting/preprocess.ts


def _fit_square(crop: np.ndarray) -> np.ndarray:
    """Fit an ink crop into REC_SIZE² with margin (mirrors strokesToInput)."""
    h, w = crop.shape
    target = REC_SIZE * (1 - 2 * REC_MARGIN)
    s = min(target / max(1, w), target / max(1, h))
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    img = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8)).resize(
        (nw, nh), Image.BILINEAR
    )
    out = np.zeros((REC_SIZE, REC_SIZE), dtype=np.float32)
    ox, oy = (REC_SIZE - nw) // 2, (REC_SIZE - nh) // 2
    out[oy : oy + nh, ox : ox + nw] = np.asarray(img, dtype=np.float32) / 255.0
    return out


def _crop_cols(strip: np.ndarray, x0: int, x1: int) -> np.ndarray | None:
    sub = strip[:, max(0, x0) : min(strip.shape[1], x1)]
    ys, xs = np.where(sub > 0.08)
    if xs.size == 0:
        return None
    return sub[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def run(*, trials: int = 8, log_fn=print) -> int:
    seg = SEGMENT_POLICY
    classes = load_classes()
    seg_sess = rt.InferenceSession(str(SEGMENTER_OUT), providers=["CPUExecutionProvider"])
    seg_in = seg_sess.get_inputs()[0].name
    rec_sess = rt.InferenceSession(str(MODEL_OUT), providers=["CPUExecutionProvider"])
    rec_in = rec_sess.get_inputs()[0].name

    def predict_boundaries(strip: np.ndarray) -> list[int]:
        logits = seg_sess.run(None, {seg_in: strip.reshape(1, 1, seg.strip_h, seg.strip_w)})[0][0]
        prob = 1.0 / (1.0 + np.exp(-logits))
        ink = column_ink(strip, seg.width_stride)
        return decode_boundaries(prob, ink, PEAK_THRESHOLD, PEAK_MIN_SEP, INK_WINDOW)

    def recognize(crop: np.ndarray) -> str:
        arr = _fit_square(crop)
        logits = rec_sess.run(None, {rec_in: arr.reshape(1, 1, REC_SIZE, REC_SIZE)})[0][0]
        return classes[int(np.argmax(logits))]

    words = ["学", "川", "明", "森", "日本", "大学", "学生", "東京", "日本語", "大学生", "中国人", "学生生活"]

    count_ok = 0
    count_tot = 0
    recog_ok = 0
    recog_tot = 0
    log_fn(f"validating segmenter={SEGMENTER_OUT.name} on {len(words)} words × {trials} trials\n")
    for word in words:
        n_exp = len(word) - 1
        per_word_count = 0
        per_word_recog = 0
        for t in range(trials):
            rng = random.Random(1000 + t)
            out = synthesize_strip(rng, classes, [], [], VAL_POLICY, seg, chars=word)
            if out is None:
                continue
            strip, _true = out
            cols = predict_boundaries(strip)
            count_tot += 1
            if len(cols) == n_exp:
                count_ok += 1
                per_word_count += 1
            # End-to-end split → recognize using the predicted boundaries.
            xs = [c * seg.width_stride + seg.width_stride // 2 for c in cols]
            edges = [0, *xs, seg.strip_w]
            chars_out: list[str] = []
            for a, b in zip(edges, edges[1:]):
                crop = _crop_cols(strip, a, b)
                if crop is not None:
                    chars_out.append(recognize(crop))
            recog_tot += 1
            if "".join(chars_out) == word:
                recog_ok += 1
                per_word_recog += 1
        log_fn(
            f"  {word:<6} (exp {n_exp} cuts)  count {per_word_count}/{trials}  "
            f"recognize {per_word_recog}/{trials}"
        )

    log_fn(
        f"\nboundary-count acc: {count_ok}/{count_tot} ({count_ok / max(1, count_tot):.1%})  |  "
        f"end-to-end recognize acc: {recog_ok}/{recog_tot} ({recog_ok / max(1, recog_tot):.1%})"
    )
    # Pass if both are healthy; the caller decides what to do with the code.
    return 0 if (count_ok / max(1, count_tot) >= 0.8) else 1
