"""Font discovery and rasterization.

Discovers installed TTF/OTF files that contain Japanese kanji glyphs, then
exposes a single ``rasterize(ch, font_path, size)`` that produces a tight,
centered grayscale bitmap of the character — the "clean print" half of the
synthetic training set.

Background = 0, ink = 1 (float). KanjiVG rasterization uses the same
convention so the dataset can shuffle samples from both paths without
re-normalizing.
"""

from __future__ import annotations

import os
import platform
import random
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


# Probe characters used to decide whether a font has Japanese kanji
# coverage. Picked to span the common-to-rare spectrum cheaply: 日 is
# everywhere, 鬱 is a hard probe that filters fonts that only carry the
# basic Jōyō subset.
_PROBES_CORE = ("日", "本", "語")
_PROBES_HARD = ("鬱", "嬲")


def _system_font_dirs() -> list[Path]:
    sys = platform.system()
    candidates: list[Path] = []
    if sys == "Windows":
        win = os.environ.get("WINDIR", r"C:\Windows")
        candidates += [Path(win) / "Fonts"]
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(Path(local) / "Microsoft" / "Windows" / "Fonts")
    elif sys == "Darwin":
        candidates += [
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            Path.home() / "Library" / "Fonts",
        ]
    else:
        candidates += [
            Path("/usr/share/fonts"),
            Path("/usr/local/share/fonts"),
            Path.home() / ".fonts",
            Path.home() / ".local" / "share" / "fonts",
        ]
    return [c for c in candidates if c.exists()]


def _iter_font_files() -> list[Path]:
    out: list[Path] = []
    for root in _system_font_dirs():
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            if ext in (".ttf", ".otf", ".ttc"):
                out.append(p)
    return out


def _font_has_japanese(path: Path) -> bool:
    """True iff the font can render the core probes at a sensible size.

    Doesn't render — uses ``getmask().getbbox()`` which returns None when
    the codepoint isn't in the font's cmap.
    """
    try:
        font = ImageFont.truetype(str(path), size=48)
    except Exception:
        return False
    for probe in _PROBES_CORE:
        try:
            bbox = font.getmask(probe).getbbox()
        except Exception:
            return False
        if bbox is None:
            return False
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        # Some fonts ship empty glyphs for unsupported codepoints with a
        # tiny placeholder rectangle — filter those out by minimum size.
        if w < 12 or h < 12:
            return False
    return True


# Diversity probe characters — picked to span common scripts (Jōyō common
# + a few mid-rarity chars + the literal `?` fallback marker). A real
# Japanese font produces visibly different renderings for each. A
# dysfunctional font (one that falls back to `.notdef` / tofu / `?`) tends
# to render most or all of these as the same rectangle.
_DIVERSITY_PROBES = ("?", "日", "本", "語", "学", "車", "東", "京", "屋", "鬱")


def _font_diversity_ok(path: Path, *, min_mean_pairwise_l1: float = 0.08) -> bool:
    """Reject fonts that render distinct kanji as visually identical bitmaps.

    Tofu (missing-glyph) renderings collapse to a fixed outline regardless
    of the requested codepoint, so the mean pairwise L1 distance between
    renderings of different chars drops near 0. Real fonts give roughly
    0.15–0.40. The 0.08 threshold catches near-degenerate fonts while
    letting legitimately-low-diversity stylistic fonts through.
    """
    try:
        font = ImageFont.truetype(str(path), size=48)
    except Exception:
        return False
    bitmaps: list[np.ndarray] = []
    canvas_size = 80
    for ch in _DIVERSITY_PROBES:
        img = Image.new("L", (canvas_size, canvas_size), color=0)
        draw = ImageDraw.Draw(img)
        try:
            draw.text((canvas_size // 2, canvas_size // 2), ch, font=font, fill=255, anchor="mm")
        except Exception:
            return False
        bitmaps.append(np.asarray(img, dtype=np.float32) / 255.0)
    if len(bitmaps) < 2:
        return False
    # Skip the literal `?` probe in the pairwise diversity calculation —
    # but DO require each kanji probe to be visually distinct from it.
    q = bitmaps[0]
    kanji = bitmaps[1:]
    # Reject if every kanji probe is essentially identical to `?` — that
    # means the font uses `?` as a fallback glyph.
    diffs_vs_q = [float(np.abs(b - q).mean()) for b in kanji]
    if max(diffs_vs_q) < 0.04:
        return False
    # Pairwise diversity across the kanji probes themselves.
    n = len(kanji)
    total = 0.0
    pairs = 0
    for i in range(n):
        for j in range(i + 1, n):
            total += float(np.abs(kanji[i] - kanji[j]).mean())
            pairs += 1
    mean_pairwise = total / max(1, pairs)
    return mean_pairwise >= min_mean_pairwise_l1


@lru_cache(maxsize=1)
def discover_japanese_fonts() -> tuple[Path, ...]:
    """All installed fonts that can render Japanese kanji.

    Cached for the process lifetime — font installation rarely changes
    during a training run, and the probe scan can be slow.

    Two-stage filter:
      1. ``_font_has_japanese`` — coarse cmap probe on 日本語. Catches fonts
         that don't claim Japanese at all.
      2. ``_font_diversity_ok`` — renders 10 probes and rejects fonts that
         produce near-identical bitmaps (tofu / `?`-fallback behaviour).
         The 56% top-1 baseline was bottlenecked by these — the model
         learned to predict `文`/`口` for any rectangular blob.
    """
    out: list[Path] = []
    seen: set[str] = set()
    for path in _iter_font_files():
        if path.name in seen:
            continue
        if not _font_has_japanese(path):
            continue
        if not _font_diversity_ok(path):
            continue
        out.append(path)
        seen.add(path.name)
    return tuple(out)


def list_fonts(*, log_fn=print) -> int:
    """CLI helper: print discovered Japanese fonts and report whether each
    handles the hard probes too."""
    fonts = discover_japanese_fonts()
    if not fonts:
        log_fn("No Japanese fonts found. Install some — see README.md.")
        return 0
    log_fn(f"Discovered {len(fonts)} Japanese font(s):")
    for path in fonts:
        font = ImageFont.truetype(str(path), size=48)
        hard_ok = all(
            (font.getmask(p).getbbox() or (0, 0, 0, 0))[2] >= 12
            for p in _PROBES_HARD
        )
        flag = "full" if hard_ok else "basic"
        log_fn(f"  [{flag:>5}] {path.name}")
    return len(fonts)


# ---------- rasterization ------------------------------------------------ #


def _load_font_cached(path: str, size: int) -> ImageFont.FreeTypeFont:
    # Manual cache — ``ImageFont.truetype`` is cheap but called millions of
    # times in a long training run, so memoizing by (path, size) helps.
    return ImageFont.truetype(path, size=size)


_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _get_font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    key = (str(path), size)
    cached = _FONT_CACHE.get(key)
    if cached is None:
        cached = _load_font_cached(*key)
        _FONT_CACHE[key] = cached
    return cached


def rasterize_with_font(
    ch: str,
    font_path: Path,
    image_size: int,
    *,
    rng: random.Random | None = None,
) -> np.ndarray:
    """Render ``ch`` with the given font onto an ``image_size`` square.

    Returns a float32 array in [0, 1] with ink=1, background=0. The glyph
    is auto-cropped to its ink bounding box, then centered with a small
    randomized margin so the model doesn't learn an exact-pixel position.
    """
    rng = rng or random
    # Render on a generous canvas first so we have room for the full glyph
    # including descenders/diacritics.
    canvas_size = image_size * 4
    glyph_target = int(image_size * 3.2)
    font = _get_font(font_path, glyph_target)

    img = Image.new("L", (canvas_size, canvas_size), color=0)
    draw = ImageDraw.Draw(img)
    draw.text((canvas_size // 2, canvas_size // 2), ch, font=font, fill=255, anchor="mm")

    bbox = img.getbbox()
    if bbox is None:
        # Defensive: the glyph rendered empty (shouldn't happen for a
        # font that passed `_font_has_japanese`, but worth a fallback).
        return np.zeros((image_size, image_size), dtype=np.float32)

    cropped = img.crop(bbox)
    cw, ch_ = cropped.size

    # Fit into image_size with a small margin (~10–14% on the larger side).
    margin_frac = 0.10 + rng.uniform(0.0, 0.04)
    target = int(image_size * (1.0 - 2 * margin_frac))
    scale = min(target / cw, target / ch_)
    new_w, new_h = max(1, int(cw * scale)), max(1, int(ch_ * scale))
    cropped = cropped.resize((new_w, new_h), Image.BILINEAR)

    out = Image.new("L", (image_size, image_size), color=0)
    # Randomize translation within the margin so position varies slightly.
    margin_x = image_size - new_w
    margin_y = image_size - new_h
    ox = margin_x // 2 + rng.randint(-margin_x // 4, margin_x // 4) if margin_x > 4 else margin_x // 2
    oy = margin_y // 2 + rng.randint(-margin_y // 4, margin_y // 4) if margin_y > 4 else margin_y // 2
    out.paste(cropped, (ox, oy))

    return np.asarray(out, dtype=np.float32) / 255.0
