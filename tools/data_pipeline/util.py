"""Shared helpers: deterministic gzip, hashing, file IO, logging."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import sys
import time
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def deterministic_gzip(data: bytes, level: int) -> bytes:
    """Gzip with mtime=0 and no embedded filename so output is byte-stable."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=level, mtime=0) as gz:
        gz.write(data)
    return buf.getvalue()


def write_gz(path: Path, data: bytes, level: int) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = deterministic_gzip(data, level)
    path.write_bytes(payload)
    return payload


def write_json(path: Path, obj: Any, *, sort_keys: bool = True) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(
        obj,
        ensure_ascii=False,
        sort_keys=sort_keys,
        separators=(",", ":"),
    ).encode("utf-8")
    path.write_bytes(data)
    return data


def dumps_compact(obj: Any, *, sort_keys: bool = False) -> bytes:
    """Compact JSON encoder used for the on-disk dictionary blob.

    ``sort_keys`` defaults to ``False`` because the words map is already
    inserted in deterministic order and we want to preserve that ordering
    for cheap diffing.
    """
    return json.dumps(
        obj,
        ensure_ascii=False,
        sort_keys=sort_keys,
        separators=(",", ":"),
    ).encode("utf-8")


class StageLog:
    """Minimal stage logger — single stream, timestamps, no dependencies."""

    def __init__(self, stream=sys.stderr) -> None:
        self.stream = stream
        self._start = time.monotonic()
        self._stage_start = self._start

    def _emit(self, msg: str) -> None:
        elapsed = time.monotonic() - self._start
        print(f"[{elapsed:7.2f}s] {msg}", file=self.stream, flush=True)

    def stage(self, name: str) -> None:
        self._stage_start = time.monotonic()
        self._emit(f"== {name} ==")

    def info(self, msg: str) -> None:
        self._emit(f"  {msg}")

    def done(self) -> None:
        dt = time.monotonic() - self._stage_start
        self._emit(f"  done in {dt:.2f}s")


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} GB"
