"""Image-space augmentation.

Applied on top of either rasterization path (font or KanjiVG). All ops are
in-place on a float32 array shaped ``(H, W)`` in [0, 1] with ink=1.

No scipy dependency — Gaussian blur of float fields goes through PIL "F"
mode, and the bilinear remap for elastic deformation is implemented in
numpy directly.
"""

from __future__ import annotations

import math
import random

import numpy as np
from PIL import Image, ImageFilter

from .config import SYNTH_POLICY, SynthesisPolicy


def _to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((arr * 255.0).clip(0, 255).astype(np.uint8), mode="L")


def _from_pil(img: Image.Image) -> np.ndarray:
    return np.asarray(img, dtype=np.float32) / 255.0


# ---------- affine ------------------------------------------------------ #


def random_affine(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    pol = policy
    # Skip with prob (1 - p_affine) so a share of samples stay at canonical
    # position — the rigid case careful real handwriting produces.
    if rng.random() >= pol.p_affine:
        return arr
    h, w = arr.shape
    angle = math.radians(rng.uniform(-pol.affine_rotate_deg, pol.affine_rotate_deg))
    sx = rng.uniform(pol.affine_scale_min, pol.affine_scale_max)
    sy = rng.uniform(pol.affine_scale_min, pol.affine_scale_max)
    shear = math.radians(rng.uniform(-pol.affine_shear_deg, pol.affine_shear_deg))
    tx = rng.uniform(-pol.affine_translate_frac, pol.affine_translate_frac) * w
    ty = rng.uniform(-pol.affine_translate_frac, pol.affine_translate_frac) * h

    # Compose around image center. PIL's `Image.AFFINE` takes the inverse
    # matrix mapping output → input coordinates: (a, b, c, d, e, f) where
    #   x_in = a * x_out + b * y_out + c
    #   y_in = d * x_out + e * y_out + f
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    # Forward matrix (about origin): rotation × shear × scale.
    fa = cos_a * sx
    fb = -sin_a * sy + cos_a * sx * math.tan(shear)
    fd = sin_a * sx
    fe = cos_a * sy + sin_a * sx * math.tan(shear)
    # Translate so the image center maps to itself, then offset by (tx, ty).
    cx, cy = w / 2.0, h / 2.0
    fc = cx - fa * cx - fb * cy + tx
    ff = cy - fd * cx - fe * cy + ty
    # Invert 2×2 part for the PIL inverse-mapping convention.
    det = fa * fe - fb * fd
    if abs(det) < 1e-6:
        return arr
    ia = fe / det
    ib = -fb / det
    id_ = -fd / det
    ie = fa / det
    ic = -(ia * fc + ib * ff)
    if_ = -(id_ * fc + ie * ff)

    img = _to_pil(arr)
    out = img.transform(
        (w, h),
        Image.AFFINE,
        (ia, ib, ic, id_, ie, if_),
        resample=Image.BILINEAR,
        fillcolor=0,
    )
    return _from_pil(out)


# ---------- elastic deformation (Simard et al. 2003) -------------------- #


def _gaussian_blur_field(field: np.ndarray, sigma: float) -> np.ndarray:
    # PIL 12.x removed GaussianBlur support for "F" (float32) mode. scipy's
    # gaussian_filter works on floats natively and is comparable in speed.
    from scipy.ndimage import gaussian_filter

    return gaussian_filter(field, sigma=sigma, mode="reflect").astype(np.float32)


def elastic_deform(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    pol = policy
    # Apply only with prob p_elastic so a share of samples stay un-warped
    # (rigid) — see the rigidity note in config.SynthesisPolicy.
    if pol.elastic_alpha <= 0 or rng.random() >= pol.p_elastic:
        return arr
    h, w = arr.shape
    # Per-pixel displacement field, smoothed and scaled. Sampling via numpy
    # rather than Python-level rng.gauss() — millions of normal draws per
    # image otherwise dominates the synthesis time.
    seed = rng.randrange(2**32)
    rs = np.random.default_rng(seed)
    rand_dx = rs.standard_normal((h, w), dtype=np.float32)
    rand_dy = rs.standard_normal((h, w), dtype=np.float32)
    dx_field = _gaussian_blur_field(rand_dx, pol.elastic_sigma) * pol.elastic_alpha
    dy_field = _gaussian_blur_field(rand_dy, pol.elastic_sigma) * pol.elastic_alpha

    # Build sampling grid: output[y, x] = input[y + dy[y, x], x + dx[y, x]].
    yy, xx = np.meshgrid(np.arange(h, dtype=np.float32), np.arange(w, dtype=np.float32), indexing="ij")
    src_x = xx + dx_field
    src_y = yy + dy_field

    # Bilinear remap.
    x0 = np.floor(src_x).astype(np.int32)
    y0 = np.floor(src_y).astype(np.int32)
    x1 = x0 + 1
    y1 = y0 + 1
    fx = src_x - x0
    fy = src_y - y0
    x0c = np.clip(x0, 0, w - 1)
    x1c = np.clip(x1, 0, w - 1)
    y0c = np.clip(y0, 0, h - 1)
    y1c = np.clip(y1, 0, h - 1)
    Ia = arr[y0c, x0c]
    Ib = arr[y1c, x0c]
    Ic = arr[y0c, x1c]
    Id = arr[y1c, x1c]
    out = (
        Ia * (1 - fx) * (1 - fy)
        + Ic * fx * (1 - fy)
        + Ib * (1 - fx) * fy
        + Id * fx * fy
    )
    return out.astype(np.float32)


# ---------- morphology (dilate / erode = thicker / thinner strokes) ----- #


def random_morphology(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    pol = policy
    r = rng.random()
    if r < pol.p_dilate:
        img = _to_pil(arr).filter(ImageFilter.MaxFilter(3))
        return _from_pil(img)
    if r < pol.p_dilate + pol.p_erode:
        img = _to_pil(arr).filter(ImageFilter.MinFilter(3))
        return _from_pil(img)
    return arr


# ---------- noise / dropout / blur -------------------------------------- #


def random_pixel_dropout(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    pol = policy
    if rng.random() >= pol.p_pixel_dropout:
        return arr
    seed = rng.randrange(2**32)
    rs = np.random.default_rng(seed)
    mask = rs.random(arr.shape, dtype=np.float32) < pol.pixel_dropout_frac
    out = arr.copy()
    # Drop ink pixels (simulate ink-break / pen-lift gaps), not background.
    out[mask] = np.minimum(out[mask], 0.0)
    return out


def gaussian_noise(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    pol = policy
    if pol.gaussian_noise_std <= 0:
        return arr
    seed = rng.randrange(2**32)
    rs = np.random.default_rng(seed)
    n = rs.standard_normal(arr.shape, dtype=np.float32) * pol.gaussian_noise_std
    return np.clip(arr + n, 0.0, 1.0)


def random_blur(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    pol = policy
    # Sharpness-invariance path (the fix for "crisp/real input is OOD"): blur
    # EVERY sample by uniform(0, sharpness_jitter_max). The range starts at 0
    # so the model sees the full spectrum from razor-sharp to soft and cannot
    # treat edge-softness as a class feature. When the knob is 0, fall back to
    # the legacy probabilistic blur so old policies reproduce exactly.
    if pol.sharpness_jitter_max > 0:
        radius = rng.uniform(0.0, pol.sharpness_jitter_max)
        if radius < 0.05:
            return arr  # effectively sharp — skip the PIL round-trip
        img = _to_pil(arr).filter(ImageFilter.GaussianBlur(radius=radius))
        return _from_pil(img)
    if rng.random() >= pol.p_blur:
        return arr
    radius = rng.uniform(0.2, pol.blur_radius_max)
    img = _to_pil(arr).filter(ImageFilter.GaussianBlur(radius=radius))
    return _from_pil(img)


# ---------- ink-style augmentation -------------------------------------- #


def ink_bleed(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    """Spread ink outward as if pen ink soaked into paper.

    Dilate the ink mask by one pixel then Gaussian-blur it. The
    re-scaling pulls the bled mask back toward full opacity at the core
    of strokes so the result is "fatter and softer-edged", not "uniformly
    grey". Combined with ``np.maximum`` against the original, strokes
    can only gain ink, never lose it.
    """
    pol = policy
    if rng.random() >= pol.p_ink_bleed:
        return arr
    radius = rng.uniform(0.4, pol.ink_bleed_max_radius)
    img = _to_pil(arr).filter(ImageFilter.MaxFilter(3))
    img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    bled = np.clip(_from_pil(img) * 1.4, 0.0, 1.0)
    return np.maximum(arr, bled).astype(np.float32)


def ink_grain(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    """Modulate ink intensity with low-frequency multiplicative noise.

    Real pen / brush ink has along-stroke intensity variation: thinner
    spots, darker pooled spots. Without this, every synthetic stroke is
    a uniform-opacity slab and the model overfits to "ink pixel = 1.0".
    """
    pol = policy
    if rng.random() >= pol.p_ink_grain:
        return arr
    from scipy.ndimage import gaussian_filter

    h, w = arr.shape
    seed = rng.randrange(2**32)
    rs = np.random.default_rng(seed)
    noise = gaussian_filter(
        rs.standard_normal((h, w), dtype=np.float32),
        sigma=pol.ink_grain_sigma,
    ).astype(np.float32)
    n_std = float(noise.std())
    if n_std < 1e-6:
        return arr
    # Normalize so roughly ±1, then scale into the configured range.
    noise = noise / (n_std * 2.0)
    modulated = arr * (1.0 + pol.ink_grain_strength * noise)
    return np.clip(modulated, 0.0, 1.0).astype(np.float32)


def random_cutout(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    """Erase a small rectangular region.

    Cheap regulariser — forces the classifier to use redundant kanji
    evidence across the glyph rather than memorising one quadrant. Runs
    last in the pipeline so the cut survives every other op.
    """
    pol = policy
    if rng.random() >= pol.p_cutout:
        return arr
    h, w = arr.shape
    cut_h = rng.randint(max(2, h // 10), max(3, int(h * pol.cutout_frac_max)))
    cut_w = rng.randint(max(2, w // 10), max(3, int(w * pol.cutout_frac_max)))
    y0 = rng.randint(0, h - cut_h)
    x0 = rng.randint(0, w - cut_w)
    out = arr.copy()
    out[y0:y0 + cut_h, x0:x0 + cut_w] = 0.0
    return out


# ---------- pipeline ---------------------------------------------------- #


def augment(arr: np.ndarray, rng: random.Random, policy: SynthesisPolicy = SYNTH_POLICY) -> np.ndarray:
    """Apply the full augmentation pipeline. Order matters:

    1. Affine (move pixels around in big rigid ways)
    2. Elastic (smooth nonlinear warp on top)
    3. Morphology (thicken/thin strokes)
    4. Ink bleed (spread ink as if wet on paper)
    5. Ink grain (along-stroke intensity variation)
    6. Pixel dropout (introduce ink breaks)
    7. Gaussian noise (sensor/scan noise)
    8. Blur (final softening)
    9. Cutout (occlude a small region)

    All steps short-circuit when their probabilities don't fire, so a
    "no-op" pass is cheap.
    """
    arr = random_affine(arr, rng, policy)
    arr = elastic_deform(arr, rng, policy)
    arr = random_morphology(arr, rng, policy)
    arr = ink_bleed(arr, rng, policy)
    arr = ink_grain(arr, rng, policy)
    arr = random_pixel_dropout(arr, rng, policy)
    arr = gaussian_noise(arr, rng, policy)
    arr = random_blur(arr, rng, policy)
    arr = random_cutout(arr, rng, policy)
    return arr
