"""Curated open-licensed font pack downloader.

System-font discovery (``fonts.discover_japanese_fonts``) is only as
strong as what the host happens to have installed — typically a couple
of Mincho/Gothic faces with near-identical shapes. This module fetches a
redistributable pack of stylistically diverse Japanese fonts so every
training host sees the same broad style coverage.

Source: ``github.com/google/fonts`` mirrors each family under either
``ofl/<familyname>/`` (OFL-licensed) or ``apache/<familyname>/`` (Apache
2.0). Each download is best-effort — a 404 / network error is logged
and skipped so a partial pack still trains. The font filter in
``fonts.py`` rejects anything that landed corrupted or empty.

Style coverage of the curated list:

* Kyokasho-tai (taught handwriting style): Klee One
* Kaisho / brush-print: Yuji Syuku, Yuji Boku, Yuji Mai, Hina Mincho
* Mincho (serif-like): Shippori Mincho, Zen Old Mincho, Sawarabi Mincho
* Gothic (sans-serif): Sawarabi Gothic, Kosugi, Kosugi Maru, Zen Maru Gothic
* Handwriting / display: Zen Kurenaido, Hachi Maru Pop, Yusei Magic,
  RocknRoll One, Reggae One, Dela Gothic One
"""

from __future__ import annotations

import urllib.error
import urllib.request
from pathlib import Path

from .config import BUNDLED_FONTS_DIR


_GOOGLE_FONTS_RAW = "https://github.com/google/fonts/raw/main"

# (license-root, subdir, filename) tuples. license-root is "ofl" for SIL
# Open Font License families and "apache" for Apache 2.0 families — the
# google/fonts tree splits them that way. Bold/SemiBold variants are
# included where the family ships them as separate files, on top of
# the faux-bold synthesised in ``rasterize_with_font``.
_FONT_FILES: list[tuple[str, str, str]] = [
    ("ofl", "kleeone", "KleeOne-Regular.ttf"),
    ("ofl", "kleeone", "KleeOne-SemiBold.ttf"),
    ("ofl", "yujisyuku", "YujiSyuku-Regular.ttf"),
    ("ofl", "yujiboku", "YujiBoku-Regular.ttf"),
    ("ofl", "yujimai", "YujiMai-Regular.ttf"),
    ("ofl", "shipporimincho", "ShipporiMincho-Regular.ttf"),
    ("ofl", "shipporimincho", "ShipporiMincho-Bold.ttf"),
    ("ofl", "zenoldmincho", "ZenOldMincho-Regular.ttf"),
    ("ofl", "zenoldmincho", "ZenOldMincho-Bold.ttf"),
    ("ofl", "hinamincho", "HinaMincho-Regular.ttf"),
    ("ofl", "sawarabimincho", "SawarabiMincho-Regular.ttf"),
    ("ofl", "sawarabigothic", "SawarabiGothic-Regular.ttf"),
    ("apache", "kosugi", "Kosugi-Regular.ttf"),
    ("apache", "kosugimaru", "KosugiMaru-Regular.ttf"),
    ("ofl", "zenmarugothic", "ZenMaruGothic-Regular.ttf"),
    ("ofl", "zenmarugothic", "ZenMaruGothic-Bold.ttf"),
    ("ofl", "zenkurenaido", "ZenKurenaido-Regular.ttf"),
    ("ofl", "hachimarupop", "HachiMaruPop-Regular.ttf"),
    ("ofl", "yuseimagic", "YuseiMagic-Regular.ttf"),
    ("ofl", "rocknrollone", "RocknRollOne-Regular.ttf"),
    ("ofl", "reggaeone", "ReggaeOne-Regular.ttf"),
    ("ofl", "delagothicone", "DelaGothicOne-Regular.ttf"),
]


# Minimum byte size for a font to count as a real download. GitHub serves
# small HTML "not found" pages for missing raw paths; the smallest TTF in
# the curated set is comfortably > 50 KiB.
_MIN_FONT_BYTES = 16 * 1024


def _download(url: str, dst: Path) -> bool:
    """Best-effort download. Returns True iff a plausibly-real font landed."""
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "jisho-app-trainer"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
    except (urllib.error.URLError, TimeoutError, OSError):
        return False
    if len(data) < _MIN_FONT_BYTES:
        return False
    dst.write_bytes(data)
    return True


def fetch_fonts(*, log_fn=print, force: bool = False) -> dict[str, int]:
    """Download the curated font pack into ``BUNDLED_FONTS_DIR``.

    Idempotent — files already on disk are left alone unless ``force``.
    Returns counts ``{downloaded, cached, failed}``.
    """
    BUNDLED_FONTS_DIR.mkdir(parents=True, exist_ok=True)
    counts = {"downloaded": 0, "cached": 0, "failed": 0}
    for license_root, family, fname in _FONT_FILES:
        dst = BUNDLED_FONTS_DIR / fname
        if dst.exists() and not force:
            counts["cached"] += 1
            continue
        url = f"{_GOOGLE_FONTS_RAW}/{license_root}/{family}/{fname}"
        if _download(url, dst):
            log_fn(f"  + {fname}")
            counts["downloaded"] += 1
        else:
            log_fn(f"  ! failed: {fname}")
            counts["failed"] += 1
    # No fancy arrow — the Windows cp1250 console can't encode U+2192.
    log_fn(
        f"fonts: {counts['downloaded']} downloaded, "
        f"{counts['cached']} cached, {counts['failed']} failed "
        f"-> {BUNDLED_FONTS_DIR}"
    )
    return counts
