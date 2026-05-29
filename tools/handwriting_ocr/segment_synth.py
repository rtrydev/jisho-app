"""Synthetic multi-character *strips* for training the boundary segmenter.

A sample is a height-normalized line of 1–4 characters rendered exactly the way
the recognizer's training data is (``rasterize_with_perturbation`` / fonts),
composited side-by-side with randomized sizes, gaps and jitter. The label is a
1-D heatmap over the model's output columns with a Gaussian bump at each
*inter-character* gap — and nothing inside a character, so the model learns the
difference between 川's internal gaps and a real character break.

No real handwriting corpus needed; this mirrors the single-character pipeline
in ``dataset.py``.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from .config import SEGMENT_POLICY, SYNTH_POLICY, SegmentPolicy, SynthesisPolicy
from .fonts import discover_japanese_fonts, rasterize_with_font
from .kanjivg import has_strokes, rasterize_with_perturbation

RENDER_SIZE = 96  # per-glyph render resolution before crop+resize


def _crop_ink(arr: np.ndarray, thresh: float = 0.08) -> np.ndarray | None:
    """Crop to the glyph's ink bounding box, dropping the renderer's margin."""
    ys, xs = np.where(arr > thresh)
    if xs.size == 0:
        return None
    return arr[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def _resize(arr: np.ndarray, new_w: int, new_h: int) -> np.ndarray:
    from PIL import Image

    img = Image.fromarray((np.clip(arr, 0.0, 1.0) * 255).astype(np.uint8))
    img = img.resize((max(1, new_w), max(1, new_h)), Image.BILINEAR)
    return np.asarray(img, dtype=np.float32) / 255.0


def _render_glyph(
    ch: str,
    has_kvg: bool,
    fonts: list[tuple[Path, int]],
    rng: random.Random,
    policy: SynthesisPolicy,
) -> np.ndarray | None:
    """One perturbed glyph, cropped to its ink bbox (or None on failure)."""
    arr: np.ndarray | None = None
    if has_kvg and rng.random() < policy.p_kanjivg:
        arr = rasterize_with_perturbation(ch, RENDER_SIZE, rng=rng, policy=policy)
    if arr is None and fonts:
        fp, fi = fonts[rng.randrange(len(fonts))]
        arr = rasterize_with_font(ch, fp, RENDER_SIZE, index=fi, rng=rng, policy=policy)
    if arr is None:
        return None
    return _crop_ink(arr)


def synthesize_strip(
    rng: random.Random,
    classes: list[str],
    has_kvg: list[bool],
    fonts: list[tuple[Path, int]],
    render_policy: SynthesisPolicy,
    seg: SegmentPolicy = SEGMENT_POLICY,
    chars: str | None = None,
) -> tuple[np.ndarray, list[float]] | None:
    """Returns (strip [H,W] float32 ink=1, boundary x-positions in px) or None.

    When ``chars`` is given, lays out exactly those characters (used by the
    validation gate); otherwise picks a random 1–4 character line."""
    glyphs: list[np.ndarray] = []
    if chars is not None:
        for ch in chars:
            g = _render_glyph(ch, has_strokes(ch), fonts, rng, render_policy)
            if g is None or g.shape[0] < 2 or g.shape[1] < 2:
                return None
            glyphs.append(g)
    else:
        n = rng.choices([1, 2, 3, 4], weights=list(seg.count_weights))[0]
        attempts = 0
        while len(glyphs) < n and attempts < n * 6:
            attempts += 1
            ci = rng.randrange(len(classes))
            g = _render_glyph(classes[ci], has_kvg[ci], fonts, rng, render_policy)
            if g is not None and g.shape[0] >= 2 and g.shape[1] >= 2:
                glyphs.append(g)
    if not glyphs:
        return None
    n = len(glyphs)

    H, W = seg.strip_h, seg.strip_w

    # Lay out: pick a cell size per glyph (scaled by the larger dimension so
    # aspect is preserved) and a gap after each but the last, then shrink the
    # whole line uniformly if it would overflow the strip.
    cells = [rng.uniform(seg.glyph_min_frac, seg.glyph_max_frac) * H for _ in glyphs]
    gaps = [rng.uniform(seg.gap_min_frac, seg.gap_max_frac) * H for _ in range(n - 1)]
    left = rng.uniform(seg.margin_min, seg.margin_max)
    right = rng.uniform(seg.margin_min, seg.margin_max)

    dims: list[tuple[float, float]] = []
    for g, cell in zip(glyphs, cells):
        gh, gw = g.shape
        s = cell / max(gh, gw)
        dims.append((gw * s, gh * s))

    total = left + right + sum(d[0] for d in dims) + sum(gaps)
    shrink = min(1.0, (W - 1) / total) if total > 0 else 1.0
    left *= shrink
    gaps = [x * shrink for x in gaps]
    dims = [(w * shrink, h * shrink) for w, h in dims]

    strip = np.zeros((H, W), dtype=np.float32)
    boundaries: list[float] = []
    x = left
    for i, (g, (dw, dh)) in enumerate(zip(glyphs, dims)):
        nw, nh = max(1, round(dw)), max(1, round(dh))
        gi = _resize(g, nw, nh)
        yj = rng.uniform(-seg.v_jitter, seg.v_jitter) * H
        y0 = int(round((H - nh) / 2 + yj))
        y0 = max(0, min(H - nh, y0))
        x0 = int(round(x))
        w_fit = min(nw, W - x0)
        if w_fit > 0:
            region = strip[y0 : y0 + nh, x0 : x0 + w_fit]
            np.maximum(region, gi[:, :w_fit], out=region)
        right_edge = x + nw
        if i < n - 1:
            boundaries.append(right_edge + gaps[i] / 2.0)
            x = right_edge + gaps[i]
        else:
            x = right_edge
    return strip, boundaries


def find_peaks(prob: np.ndarray, threshold: float, min_sep: int) -> list[int]:
    """Greedy 1-D peak picking: take columns above ``threshold`` in descending
    order, keeping a peak only if it's ≥ ``min_sep`` columns from every peak
    already kept. Mirrors the TS-side boundary decoder."""
    idx = [i for i in range(len(prob)) if prob[i] >= threshold]
    idx.sort(key=lambda i: float(prob[i]), reverse=True)
    kept: list[int] = []
    for i in idx:
        if all(abs(i - k) >= min_sep for k in kept):
            kept.append(i)
    kept.sort()
    return kept


def column_ink(strip: np.ndarray, stride: int, thresh: float = 0.1) -> np.ndarray:
    """Per output-column ink flag: True where the strip has ink in that column
    band. Used to reject boundary predictions that aren't flanked by ink."""
    h, w = strip.shape
    length = w // stride
    col_max = strip.max(axis=0)  # (w,)
    out = np.zeros(length, dtype=bool)
    for j in range(length):
        band = col_max[j * stride : (j + 1) * stride]
        out[j] = bool((band > thresh).any())
    return out


def decode_boundaries(
    prob: np.ndarray,
    ink_cols: np.ndarray,
    threshold: float,
    min_sep: int,
    ink_window: int,
) -> list[int]:
    """Peak-pick boundary columns, then keep only those flanked by ink on BOTH
    sides within ``ink_window`` columns — a real character break separates two
    ink regions, so this rejects trailing/leading-edge false positives."""
    cand = find_peaks(prob, threshold, min_sep)
    kept: list[int] = []
    for c in cand:
        left = ink_cols[max(0, c - ink_window) : c].any()
        right = ink_cols[c + 1 : min(len(ink_cols), c + 1 + ink_window)].any()
        if left and right:
            kept.append(c)
    return kept


def boundary_target(boundaries: list[float], seg: SegmentPolicy = SEGMENT_POLICY) -> np.ndarray:
    """1-D Gaussian-bump heatmap over output columns (length strip_w//stride)."""
    length = seg.strip_w // seg.width_stride
    t = np.zeros(length, dtype=np.float32)
    sigma = seg.target_sigma
    cols = np.arange(length, dtype=np.float32)
    for bx in boundaries:
        c = bx / seg.width_stride
        bump = np.exp(-((cols - c) ** 2) / (2.0 * sigma * sigma))
        np.maximum(t, bump, out=t)
    return t


class SegmentStripDataset(Dataset):
    """On-the-fly multi-character strips with boundary heatmap targets.

    Training varies the RNG seed per epoch (call ``set_epoch``); validation
    pins it per index for a stable signal — same convention as
    ``SyntheticKanjiDataset``.
    """

    def __init__(
        self,
        classes: list[str],
        length: int,
        base_seed: int,
        *,
        deterministic: bool = False,
        render_policy: SynthesisPolicy = SYNTH_POLICY,
        seg: SegmentPolicy = SEGMENT_POLICY,
    ) -> None:
        self.classes = classes
        self.length = length
        self.base_seed = base_seed
        self.deterministic = deterministic
        self.render_policy = render_policy
        self.seg = seg
        self._epoch = 0
        self._fonts: list[tuple[Path, int]] = list(discover_japanese_fonts())
        self._has_kvg = [has_strokes(c) for c in classes]

    def set_epoch(self, epoch: int) -> None:
        self._epoch = epoch

    def __len__(self) -> int:
        return self.length

    def _seed_for(self, idx: int) -> int:
        if self.deterministic:
            return self.base_seed + idx
        return self.base_seed + self._epoch * 1_000_003 + idx

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        rng = random.Random(self._seed_for(idx))
        out = None
        # Retry on the rare empty synthesis; bump the seed so we don't loop.
        for k in range(8):
            out = synthesize_strip(
                random.Random(self._seed_for(idx) + k * 7919),
                self.classes,
                self._has_kvg,
                self._fonts,
                self.render_policy,
                self.seg,
            )
            if out is not None:
                break
        if out is None:
            strip = np.zeros((self.seg.strip_h, self.seg.strip_w), dtype=np.float32)
            boundaries: list[float] = []
        else:
            strip, boundaries = out
        target = boundary_target(boundaries, self.seg)
        return (
            torch.from_numpy(strip).unsqueeze(0).contiguous(),
            torch.from_numpy(target).contiguous(),
        )
