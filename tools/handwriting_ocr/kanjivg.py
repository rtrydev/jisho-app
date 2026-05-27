"""KanjiVG fetch, parse, and vector-perturbation rasterization.

KanjiVG ships per-character SVGs with one ``<path>`` per stroke in writing
order. This module:

  1. Downloads the release archive once and caches the extracted SVGs.
  2. Parses each character's stroke ``d`` attributes into ``svgpathtools``
     ``Path`` objects, indexed by codepoint.
  3. Renders a randomly-perturbed bitmap on demand — control-point jitter,
     stroke-thickness variation, occasional stroke drop/extra, then global
     affine fitting into ``image_size`` with margin.

Background = 0, ink = 1, float32 — matching ``fonts.rasterize_with_font``.
"""

from __future__ import annotations

import io
import random
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from svgpathtools import parse_path

from .config import (
    KANJIVG_ARCHIVE,
    KANJIVG_DIR,
    KANJIVG_URL,
    SYNTH_POLICY,
    WORK_DIR,
)


# KanjiVG SVGs use a 109×109 viewport by convention.
_KVG_VIEWPORT = 109.0
# SVG namespace as declared by KanjiVG.
_SVG_NS = "http://www.w3.org/2000/svg"
_NS = {"svg": _SVG_NS}


# ---------- fetch ------------------------------------------------------- #


def fetch(*, log_fn=print, force: bool = False) -> Path:
    """Ensure the KanjiVG archive is downloaded and extracted.

    Idempotent — skips work when artifacts already exist. ``force=True``
    re-downloads.
    """
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if force or not KANJIVG_ARCHIVE.exists():
        log_fn(f"downloading KanjiVG from {KANJIVG_URL}")
        with urllib.request.urlopen(KANJIVG_URL) as resp:
            data = resp.read()
        KANJIVG_ARCHIVE.write_bytes(data)
        log_fn(f"  saved {len(data) // 1024} KiB → {KANJIVG_ARCHIVE.name}")

    kanji_dir = KANJIVG_DIR / "kanji"
    if force or not kanji_dir.exists() or not any(kanji_dir.iterdir()):
        log_fn(f"extracting {KANJIVG_ARCHIVE.name} → {KANJIVG_DIR}")
        KANJIVG_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(KANJIVG_ARCHIVE) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                # Archive contains nested directories; flatten anything
                # under a `kanji/` subdir to KANJIVG_DIR / "kanji" / NAME.
                name = info.filename.replace("\\", "/")
                if "/kanji/" not in name and not name.startswith("kanji/"):
                    continue
                rel = name.split("/kanji/", 1)[-1] if "/kanji/" in name else name[len("kanji/"):]
                if not rel.endswith(".svg"):
                    continue
                dst = kanji_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src:
                    dst.write_bytes(src.read())
        n = sum(1 for _ in kanji_dir.glob("*.svg"))
        log_fn(f"  extracted {n:,} stroke files")

    return kanji_dir


def _svg_path_for(codepoint: int) -> Path:
    # Variant-free base file: zero-padded 5-digit lowercase hex.
    return KANJIVG_DIR / "kanji" / f"{codepoint:05x}.svg"


# ---------- parse ------------------------------------------------------- #


def _extract_stroke_d_strings(svg_path: Path) -> list[str]:
    """Return the ``d`` attribute of every stroke ``<path>`` in document order.

    KanjiVG marks stroke paths with an ``id`` like ``kvg:0f9a1-s1`` and
    sometimes a ``kvg:type`` attribute. The simplest robust extractor is
    "every ``<path>`` under the root", in source order — that's exactly the
    writing order.
    """
    tree = ET.parse(svg_path)
    root = tree.getroot()
    out: list[str] = []
    for path_elem in root.iter(f"{{{_SVG_NS}}}path"):
        d = path_elem.get("d")
        if d:
            out.append(d)
    return out


def _sample_path_points(d: str, n_points: int = 24) -> list[tuple[float, float]]:
    """Sample ``n_points`` points evenly by parameter along an SVG path."""
    try:
        path = parse_path(d)
    except Exception:
        return []
    if path.length() == 0:
        return []
    # Evenly-spaced t values — KanjiVG strokes are short Bezier sequences,
    # uniform-t sampling is close enough to arc-length for jitter purposes
    # and avoids the cost of full arc-length parameterization.
    pts: list[tuple[float, float]] = []
    for i in range(n_points):
        t = i / max(1, n_points - 1)
        try:
            z = path.point(t)
        except Exception:
            continue
        pts.append((float(z.real), float(z.imag)))
    return pts


@lru_cache(maxsize=8192)
def _strokes_for(codepoint: int) -> tuple[tuple[tuple[float, float], ...], ...]:
    """Per-stroke sampled point arrays for a character. Cached LRU.

    Returns an empty tuple if KanjiVG has no entry for the character.
    """
    svg_path = _svg_path_for(codepoint)
    if not svg_path.exists():
        return ()
    out: list[tuple[tuple[float, float], ...]] = []
    for d in _extract_stroke_d_strings(svg_path):
        pts = _sample_path_points(d)
        if len(pts) >= 2:
            out.append(tuple(pts))
    return tuple(out)


def has_strokes(ch: str) -> bool:
    return bool(_strokes_for(ord(ch)))


# ---------- rasterize --------------------------------------------------- #


def _affine_fit_strokes(
    strokes: list[list[tuple[float, float]]],
    image_size: int,
    margin_frac: float,
) -> list[list[tuple[float, float]]]:
    """Fit all points into ``[margin, image_size - margin]`` preserving aspect."""
    xs = [p[0] for s in strokes for p in s]
    ys = [p[1] for s in strokes for p in s]
    if not xs:
        return strokes
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    w = max(1e-3, x1 - x0)
    h = max(1e-3, y1 - y0)
    target = image_size * (1.0 - 2 * margin_frac)
    scale = min(target / w, target / h)
    # Center within the available square.
    cx = (image_size - w * scale) / 2.0
    cy = (image_size - h * scale) / 2.0
    out: list[list[tuple[float, float]]] = []
    for s in strokes:
        out.append([
            ((p[0] - x0) * scale + cx, (p[1] - y0) * scale + cy)
            for p in s
        ])
    return out


def rasterize_with_perturbation(
    ch: str,
    image_size: int,
    *,
    rng: random.Random | None = None,
) -> np.ndarray | None:
    """Render ``ch`` from KanjiVG strokes with per-stroke perturbation.

    Returns None if KanjiVG has no entry for the character — caller should
    fall back to the font path.
    """
    rng = rng or random
    base = _strokes_for(ord(ch))
    if not base:
        return None

    pol = SYNTH_POLICY

    # --- Perturb each stroke's sampled points -------------------------- #
    strokes: list[list[tuple[float, float]]] = []
    for stroke_pts in base:
        if rng.random() < pol.p_drop_stroke:
            continue
        jitter = pol.stroke_jitter_px
        strokes.append([
            (x + rng.gauss(0.0, jitter), y + rng.gauss(0.0, jitter))
            for x, y in stroke_pts
        ])

    # --- Possibly add a short extraneous stroke ------------------------ #
    if rng.random() < pol.p_extra_stroke:
        cx = rng.uniform(_KVG_VIEWPORT * 0.2, _KVG_VIEWPORT * 0.8)
        cy = rng.uniform(_KVG_VIEWPORT * 0.2, _KVG_VIEWPORT * 0.8)
        dx = rng.uniform(-12, 12)
        dy = rng.uniform(-12, 12)
        strokes.append([(cx, cy), (cx + dx, cy + dy)])

    if not strokes:
        # We dropped everything — should be exceedingly rare; fall back to
        # the unperturbed base so we never return an all-zero training image.
        strokes = [list(s) for s in base]

    # --- Fit into the target image with margin ------------------------- #
    margin_frac = 0.10 + rng.uniform(0.0, 0.04)
    strokes = _affine_fit_strokes(strokes, image_size, margin_frac)

    # --- Pick stroke thickness ----------------------------------------- #
    base_w = rng.uniform(pol.stroke_thickness_min, pol.stroke_thickness_max)

    # --- Rasterize ----------------------------------------------------- #
    # Render at 2× resolution then downsample with BILINEAR — gives
    # anti-aliased edges without the cost of per-pixel sub-pixel rendering.
    scale = 2
    canvas = Image.new("L", (image_size * scale, image_size * scale), color=0)
    draw = ImageDraw.Draw(canvas)

    for stroke in strokes:
        # Random thickness for this stroke, jittered around the drawing's
        # base thickness so the strokes look like they came from one pen.
        w = max(1.0, base_w + rng.uniform(-pol.stroke_thickness_vary, pol.stroke_thickness_vary))
        r = (w * scale) / 2.0
        prev: tuple[float, float] | None = None
        for x, y in stroke:
            x2, y2 = x * scale, y * scale
            if prev is not None:
                draw.line([prev, (x2, y2)], fill=255, width=max(1, int(round(w * scale))))
            # Round cap — a filled circle at each sample point eliminates
            # the polygonal "elbow" PIL leaves at sharp direction changes.
            draw.ellipse(
                [x2 - r, y2 - r, x2 + r, y2 + r],
                fill=255,
            )
            prev = (x2, y2)

    out = canvas.resize((image_size, image_size), Image.BILINEAR)
    return np.asarray(out, dtype=np.float32) / 255.0
