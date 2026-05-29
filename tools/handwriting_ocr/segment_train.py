"""Train the character-boundary segmenter.

Small fully-convolutional model, binary-ish heatmap target, synthesized
multi-character strips. Selects the checkpoint by *boundary-count accuracy* on a
held-out (deterministic) validation split — the metric that actually matters for
splitting a drawing into the right number of characters — with val loss as the
tie-breaker.
"""

from __future__ import annotations

import time

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from .classes import load_classes
from .config import (
    SEGMENT_POLICY,
    SEGMENTER_CHECKPOINT_DIR,
    SYNTH_POLICY,
    VAL_POLICY,
)
from .config import SEGMENT_POLICY
from .segment_model import BoundaryNet, param_count, smoke_forward
from .segment_synth import SegmentStripDataset, column_ink, decode_boundaries, find_peaks

# Boundary-decode settings; kept in sync with the TS-side decoder
# (segmentStrip.ts).
PEAK_THRESHOLD = 0.40
PEAK_MIN_SEP = 6   # output columns (~24 px at stride 4) ≈ 0.4 char
INK_WINDOW = 12    # require ink within this many columns on each side (~1 char)


def _count_accuracy(
    logits: torch.Tensor, targets: torch.Tensor, strips: torch.Tensor
) -> tuple[int, int]:
    """How often the predicted boundary count matches the true count. Decoded
    with the ink-flanking filter (same as deployment), so trailing-edge
    false positives don't inflate the count."""
    probs = torch.sigmoid(logits).cpu().numpy()
    tgts = targets.cpu().numpy()
    strip_np = strips.squeeze(1).cpu().numpy()
    stride = SEGMENT_POLICY.width_stride
    correct = 0
    for p, t, s in zip(probs, tgts, strip_np):
        ink = column_ink(s, stride)
        pred = len(decode_boundaries(p, ink, PEAK_THRESHOLD, PEAK_MIN_SEP, INK_WINDOW))
        true = len(find_peaks(t, 0.5, PEAK_MIN_SEP))
        if pred == true:
            correct += 1
    return correct, len(probs)


def train(
    *,
    epochs: int = 20,
    batch_size: int = 64,
    train_samples: int = 6000,
    val_samples: int = 800,
    learning_rate: float = 2e-3,
    weight_decay: float = 1e-4,
    pos_weight: float = 8.0,
    num_workers: int = 4,
    seed: int = 20260526,
    log_fn=print,
) -> None:
    torch.manual_seed(seed)
    classes = load_classes()
    log_fn(f"classes: {len(classes):,}")

    seg = SEGMENT_POLICY
    train_ds = SegmentStripDataset(
        classes, train_samples, base_seed=seed, render_policy=SYNTH_POLICY, seg=seg
    )
    val_ds = SegmentStripDataset(
        classes, val_samples, base_seed=7, deterministic=True, render_policy=VAL_POLICY, seg=seg
    )
    log_fn(
        f"fonts: {len(train_ds._fonts)}; "
        f"kanjivg coverage: {sum(train_ds._has_kvg) / len(classes):.1%}"
    )

    pin = False
    train_dl = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True, num_workers=num_workers,
        pin_memory=pin, persistent_workers=num_workers > 0, drop_last=True,
    )
    val_dl = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False, num_workers=num_workers,
        pin_memory=pin, persistent_workers=num_workers > 0,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = BoundaryNet(strip_h=seg.strip_h).to(device)
    log_fn(f"model: BoundaryNet, {param_count(model):,} params; out shape {tuple(smoke_forward(model, seg.strip_h, seg.strip_w))}")

    crit = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([pos_weight], device=device))
    opt = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    SEGMENTER_CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    best_acc = -1.0
    best_loss = float("inf")

    def validate() -> tuple[float, float]:
        model.eval()
        tot_loss, correct, total = 0.0, 0, 0
        with torch.no_grad():
            for strips, targets in val_dl:
                strips, targets = strips.to(device), targets.to(device)
                logits = model(strips)
                tot_loss += crit(logits, targets).item() * strips.size(0)
                c, t = _count_accuracy(logits, targets, strips)
                correct += c
                total += t
        return tot_loss / max(1, total), correct / max(1, total)

    for epoch in range(epochs):
        train_ds.set_epoch(epoch)
        model.train()
        t0 = time.time()
        running = 0.0
        seen = 0
        for strips, targets in train_dl:
            strips, targets = strips.to(device), targets.to(device)
            opt.zero_grad()
            logits = model(strips)
            loss = crit(logits, targets)
            loss.backward()
            opt.step()
            running += loss.item() * strips.size(0)
            seen += strips.size(0)
        sched.step()
        val_loss, val_acc = validate()
        log_fn(
            f"epoch {epoch + 1:2d}/{epochs}  train_loss {running / max(1, seen):.4f}  "
            f"val_loss {val_loss:.4f}  count_acc {val_acc:.3f}  ({time.time() - t0:.0f}s)"
        )
        torch.save(
            {
                "model_state": model.state_dict(),
                "arch": "boundary_net",
                "strip_h": seg.strip_h,
                "strip_w": seg.strip_w,
                "width_stride": seg.width_stride,
            },
            SEGMENTER_CHECKPOINT_DIR / "last.pt",
        )
        improved = (val_acc > best_acc) or (val_acc == best_acc and val_loss < best_loss)
        if improved:
            best_acc, best_loss = val_acc, val_loss
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "arch": "boundary_net",
                    "strip_h": seg.strip_h,
                    "strip_w": seg.strip_w,
                    "width_stride": seg.width_stride,
                },
                SEGMENTER_CHECKPOINT_DIR / "best.pt",
            )
            log_fn(f"  ↑ new best (count_acc {best_acc:.3f})")

    log_fn(f"done. best count_acc {best_acc:.3f} → {SEGMENTER_CHECKPOINT_DIR / 'best.pt'}")
