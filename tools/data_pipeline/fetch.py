"""Out-of-band downloader for operator-supplied pipeline sources.

The pipeline itself never downloads — Stage 0 only validates and pins what
the operator placed in ``data/``. This helper is the deliberately separate
step that puts the files there in the first place.

All sources come from EDRDG's canonical servers
(``www.edrdg.org`` and ``ftp.edrdg.org``), which are the authoritative
distribution points maintained by Jim Breen and the Electronic Dictionary
Research and Development Group. Every file we fetch here is licensed under
**Creative Commons Attribution-ShareAlike 4.0**; the existing
``ATTRIBUTION.md`` mechanism in Stage 5 picks them up automatically once
they're checksummed at Stage 0.

Usage::

    python -m tools.data_pipeline.fetch                  # fetch all missing
    python -m tools.data_pipeline.fetch kanjidic2 kradfile
    python -m tools.data_pipeline.fetch --force          # re-download all

Run this once per source-set refresh. EDRDG updates KANJIDIC2 about
monthly; the radical files change rarely. Reproducibility is enforced by
SHA256 pinning at Stage 0, not by re-running this fetcher.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .config import DATA_DIR


@dataclass(frozen=True)
class FetchSource:
    name: str
    url: str
    dest: str
    description: str
    license: str = "EDRDG, CC BY-SA 4.0"
    # When set, the downloaded file is treated as a ZIP and only this
    # entry is extracted into ``data/`` under the same name (or
    # ``extract_as`` when distinct). The ZIP itself is then removed.
    extract: str | None = None
    extract_as: str | None = None


# Single source of truth for what we can fetch and where it comes from. The
# URLs target EDRDG's own servers — no third-party mirrors, so the chain of
# custody is auditable and the license terms are unambiguous.
SOURCES: tuple[FetchSource, ...] = (
    # Note on hosts: EDRDG's ftp.edrdg.org subdomain has a long-standing SSL
    # cert hostname-mismatch issue (the cert covers www.edrdg.org only). The
    # same files are mirrored under https://www.edrdg.org/pub/Nihongo/, so
    # we point there for proper TLS — same content, same provenance.
    FetchSource(
        name="jmdict",
        url="https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
        dest="JMdict_e.gz",
        description=(
            "JMdict (English variant) — the project's primary vocabulary "
            "dictionary. ~12 MB gzipped, ~217k entries."
        ),
    ),
    FetchSource(
        name="kanjidic2",
        url="https://www.edrdg.org/kanjidic/kanjidic2.xml.gz",
        dest="kanjidic2.xml.gz",
        description=(
            "KANJIDIC2 — per-kanji metadata (strokes, JLPT, grade, frequency, "
            "on/kun readings, English meanings). Feeds Stage 7. ~3 MB gzipped."
        ),
    ),
    FetchSource(
        name="kradfile",
        url="https://www.edrdg.org/pub/Nihongo/kradzip.zip",
        dest="kradzip.zip",
        extract="radkfilex",
        extract_as="radkfilex",
        description=(
            "RADKFILEX — radical → kanji mapping (combined extended set: "
            "JIS X 0208 common kanji + JIS X 0212 supplement, ~12k chars). "
            "EUC-JP encoded; Stage 7's parser handles the encoding "
            "transparently. The archive also contains radkfile (JIS X 0208 "
            "only, ~6.3k chars) and radkfile2 (JIS X 0212 supplement only, "
            "without the common chars); radkfilex is the combined file."
        ),
    ),
)


_USER_AGENT = "jisho-app-fetch/1.0 (+https://www.edrdg.org/)"


def _print(msg: str = "") -> None:
    print(msg, file=sys.stderr, flush=True)


def _human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n //= 1024
    return f"{n:.1f} GB"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path) -> int:
    """Download ``url`` → ``dest`` with a sensible UA. Returns byte count."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length", "0")) or None
            tmp = dest.with_suffix(dest.suffix + ".part")
            with tmp.open("wb") as f:
                read = 0
                # 256 KB chunks — small enough to surface progress, big
                # enough to keep syscall overhead negligible.
                for chunk in iter(lambda: resp.read(256 * 1024), b""):
                    f.write(chunk)
                    read += len(chunk)
                    if total:
                        pct = 100 * read / total
                        print(
                            f"    {_human_bytes(read)} / {_human_bytes(total)} ({pct:.0f}%)",
                            end="\r",
                            file=sys.stderr,
                            flush=True,
                        )
            tmp.replace(dest)
            if total:
                # Clear the progress line.
                print(" " * 60, end="\r", file=sys.stderr)
            return read
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} from {url}: {e.reason}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"Network error fetching {url}: {e.reason}") from e


def _extract_one(zip_path: Path, member: str, dest: Path) -> int:
    """Pull a single named file out of a ZIP into ``dest``. Returns bytes."""
    with zipfile.ZipFile(zip_path) as zf:
        # The kradzip archive has a flat layout, but tolerate trailing-slash
        # member names and nested folders just in case a future release
        # reorganizes — match on basename.
        names = zf.namelist()
        match = next(
            (n for n in names if n == member or n.endswith("/" + member)),
            None,
        )
        if match is None:
            raise SystemExit(
                f"{zip_path.name}: ZIP does not contain {member!r}. "
                f"Available: {', '.join(sorted(names))}"
            )
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(match) as src, dest.open("wb") as out:
            shutil.copyfileobj(src, out)
        return dest.stat().st_size


def _final_path(src: FetchSource) -> Path:
    """Filesystem path the pipeline will read from after a successful fetch."""
    if src.extract:
        return DATA_DIR / (src.extract_as or src.extract)
    return DATA_DIR / src.dest


def fetch_one(src: FetchSource, *, force: bool) -> None:
    final = _final_path(src)
    if final.exists() and not force:
        _print(f"  · {src.name}: already at {final.relative_to(DATA_DIR.parent)} — skip (--force to refetch)")
        return

    _print(f"  · {src.name}: {src.description}")
    _print(f"    license: {src.license}")
    _print(f"    url: {src.url}")

    if src.extract is None:
        # Direct download into data/.
        bytes_in = _download(src.url, final)
        sha = _sha256(final)
        _print(f"    → {final.relative_to(DATA_DIR.parent)}  {_human_bytes(bytes_in)}  sha256={sha[:16]}…")
        return

    # ZIP intermediate. Download to data/ then extract the named member; the
    # raw ZIP stays in data/ as an audit artifact so a future re-extract of
    # a different member doesn't need a re-fetch.
    zip_path = DATA_DIR / src.dest
    zip_bytes = _download(src.url, zip_path)
    zip_sha = _sha256(zip_path)
    extracted_bytes = _extract_one(zip_path, src.extract, final)
    extracted_sha = _sha256(final)
    _print(f"    archive → {zip_path.relative_to(DATA_DIR.parent)}  {_human_bytes(zip_bytes)}  sha256={zip_sha[:16]}…")
    _print(f"    extracted {src.extract} → {final.relative_to(DATA_DIR.parent)}  {_human_bytes(extracted_bytes)}  sha256={extracted_sha[:16]}…")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m tools.data_pipeline.fetch",
        description=__doc__.splitlines()[0] if __doc__ else "Fetch pipeline sources.",
    )
    p.add_argument(
        "sources",
        nargs="*",
        choices=[s.name for s in SOURCES] + [[]],  # type: ignore[list-item]
        help="One or more source names. Omit to fetch every missing source.",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Re-download even when the destination already exists.",
    )
    p.add_argument(
        "--list",
        action="store_true",
        help="List available sources with URLs and licenses, then exit.",
    )
    return p


def _print_listing() -> None:
    _print("Available sources (all from EDRDG, CC BY-SA 4.0):")
    _print("")
    for s in SOURCES:
        _print(f"  {s.name}")
        _print(f"    {s.description}")
        _print(f"    URL: {s.url}")
        if s.extract:
            _print(f"    Extracts: {s.extract} → data/{s.extract_as or s.extract}")
        else:
            _print(f"    Lands at: data/{s.dest}")
        _print("")


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    if args.list:
        _print_listing()
        return 0

    requested = args.sources or [s.name for s in SOURCES]
    by_name = {s.name: s for s in SOURCES}

    _print(f"Fetching to {DATA_DIR.relative_to(DATA_DIR.parent)}/")
    _print("All sources from EDRDG (CC BY-SA 4.0). Attribution emitted at Stage 5.")
    _print("")

    for name in requested:
        src = by_name[name]
        fetch_one(src, force=args.force)

    _print("")
    _print("Done. Now run: python -m tools.data_pipeline")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
