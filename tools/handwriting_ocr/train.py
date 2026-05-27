"""Training driver.

Plain PyTorch — no Lightning, no accelerate. AdamW + cosine LR with linear
warmup, label-smoothed cross-entropy, AMP on CUDA, top-1 / top-5 reported,
best checkpoint by top-5 validation accuracy.

The data path is ``SyntheticKanjiDataset`` from ``dataset.py``; this module
just orchestrates the loop and persistence. Re-runnable: a checkpoint
in ``CHECKPOINT_DIR`` resumes training (epochs continue from the saved
epoch index).
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader

from .classes import load_classes
from .config import CHECKPOINT_DIR, TRAIN_POLICY
from .dataset import SyntheticKanjiDataset
from .model import build_model, param_count, smoke_forward


# ---------- bookkeeping ------------------------------------------------- #


@dataclass
class EpochStats:
    epoch: int
    train_loss: float
    train_top1: float
    train_top5: float
    val_loss: float
    val_top1: float
    val_top5: float
    seconds: float


@dataclass
class RunHistory:
    stats: list[EpochStats] = field(default_factory=list)
    best_top5: float = 0.0
    best_epoch: int = -1


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def _topk_correct(logits: torch.Tensor, labels: torch.Tensor, ks: Iterable[int]) -> dict[int, int]:
    maxk = max(ks)
    _, pred = logits.topk(maxk, dim=1)  # (B, maxk)
    correct = pred.eq(labels.unsqueeze(1))  # (B, maxk)
    return {k: int(correct[:, :k].any(dim=1).sum().item()) for k in ks}


def _cosine_lr(epoch: int, total: int, warmup: int, base_lr: float) -> float:
    if epoch < warmup:
        return base_lr * (epoch + 1) / max(1, warmup)
    progress = (epoch - warmup) / max(1, total - warmup)
    return base_lr * 0.5 * (1.0 + math.cos(math.pi * progress))


# ---------- loop -------------------------------------------------------- #


def _run_epoch(
    *,
    model: nn.Module,
    loader: DataLoader,
    optim: torch.optim.Optimizer | None,
    loss_fn: nn.Module,
    device: torch.device,
    scaler: "torch.amp.GradScaler | None",
    use_amp: bool,
) -> tuple[float, float, float]:
    """Returns (mean_loss, top1_acc, top5_acc)."""
    training = optim is not None
    model.train(training)
    total_loss = 0.0
    n_samples = 0
    correct = {1: 0, 5: 0}

    for batch_idx, (x, y) in enumerate(loader):
        x = x.to(device, non_blocking=True)
        y = y.to(device, non_blocking=True)

        with torch.set_grad_enabled(training):
            if use_amp and device.type == "cuda":
                with torch.amp.autocast("cuda"):
                    logits = model(x)
                    loss = loss_fn(logits, y)
            else:
                logits = model(x)
                loss = loss_fn(logits, y)

        if training:
            optim.zero_grad(set_to_none=True)
            if scaler is not None:
                scaler.scale(loss).backward()
                scaler.step(optim)
                scaler.update()
            else:
                loss.backward()
                optim.step()

        total_loss += loss.item() * x.size(0)
        n_samples += x.size(0)
        tk = _topk_correct(logits.detach(), y, (1, 5))
        for k, v in tk.items():
            correct[k] += v

    mean_loss = total_loss / max(1, n_samples)
    return mean_loss, correct[1] / max(1, n_samples), correct[5] / max(1, n_samples)


def _save_checkpoint(
    *,
    path: Path,
    model: nn.Module,
    optim: torch.optim.Optimizer,
    epoch: int,
    history: RunHistory,
    classes: list[str],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "optim_state": optim.state_dict(),
            "epoch": epoch,
            "history": history,
            "classes": classes,
        },
        path,
    )


def _load_checkpoint(
    path: Path,
    *,
    model: nn.Module,
    optim: torch.optim.Optimizer,
) -> tuple[int, RunHistory]:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_state"])
    optim.load_state_dict(ckpt["optim_state"])
    return int(ckpt["epoch"]), ckpt["history"]


def train(
    *,
    epochs: int | None = None,
    batch_size: int | None = None,
    resume: bool = True,
    limit_classes: int | None = None,
    samples_per_class: int | None = None,
    arch: str = "mobilenet_v3_small",
    num_workers: int | None = None,
    patience: int | None = None,
    log_fn=print,
) -> Path:
    """Run training to completion. Returns the path of the best checkpoint."""
    pol = TRAIN_POLICY
    epochs = epochs or pol.epochs
    batch_size = batch_size or pol.batch_size

    _seed_everything(pol.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    classes = load_classes()
    if limit_classes is not None and limit_classes < len(classes):
        classes = classes[:limit_classes]
        log_fn(f"limit-classes: truncating to first {len(classes):,}")
    log_fn(f"classes: {len(classes):,}")

    samples = samples_per_class or pol.samples_per_class_per_epoch
    train_ds = SyntheticKanjiDataset(
        classes,
        samples_per_class=samples,
        base_seed=pol.seed,
        deterministic=False,
    )
    val_ds = SyntheticKanjiDataset(
        classes,
        samples_per_class=pol.val_samples_per_class,
        base_seed=pol.seed ^ 0xDEADBEEF,
        deterministic=True,
    )
    log_fn(
        f"data: {train_ds.font_count} JP fonts, "
        f"KanjiVG covers {train_ds.kanjivg_coverage * 100:.1f}% of classes"
    )

    workers = num_workers if num_workers is not None else pol.num_workers
    log_fn(f"data loader: num_workers={workers} (override) " if num_workers is not None
           else f"data loader: num_workers={workers} (TrainPolicy default)")
    train_loader = DataLoader(
        train_ds,
        batch_size=batch_size,
        shuffle=True,
        num_workers=workers,
        pin_memory=pol.pin_memory and device.type == "cuda",
        drop_last=True,
        persistent_workers=workers > 0,
        # Larger prefetch buffer when we have workers — keeps the GPU fed
        # across step-to-step variance in synthesis cost (KanjiVG path is
        # ~3× heavier than font path).
        prefetch_factor=4 if workers > 0 else None,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=batch_size,
        shuffle=False,
        num_workers=workers,
        pin_memory=pol.pin_memory and device.type == "cuda",
        drop_last=False,
        persistent_workers=workers > 0,
        prefetch_factor=4 if workers > 0 else None,
    )

    model = build_model(num_classes=len(classes), arch=arch).to(device)  # type: ignore[arg-type]
    log_fn(f"model: arch={arch}, {param_count(model) / 1e6:.2f}M params")
    log_fn(f"smoke forward: {smoke_forward(model)}")

    optim = torch.optim.AdamW(
        model.parameters(),
        lr=pol.learning_rate,
        weight_decay=pol.weight_decay,
    )
    loss_fn = nn.CrossEntropyLoss(label_smoothing=pol.label_smoothing)
    scaler = torch.amp.GradScaler("cuda", enabled=pol.use_amp and device.type == "cuda")

    history = RunHistory()
    start_epoch = 0

    # Per-arch checkpoint dirs so consecutive experiments don't clobber each
    # other's best models, but the default arch keeps the original path.
    ckpt_dir = CHECKPOINT_DIR if arch == "mobilenet_v3_small" else CHECKPOINT_DIR / arch
    last_ckpt = ckpt_dir / "last.pt"
    best_ckpt = ckpt_dir / "best.pt"
    if resume and last_ckpt.exists():
        start_epoch, history = _load_checkpoint(last_ckpt, model=model, optim=optim)
        start_epoch += 1
        log_fn(f"resumed from epoch {start_epoch} (best top-5 so far: {history.best_top5 * 100:.2f}%)")

    for epoch in range(start_epoch, epochs):
        t0 = time.monotonic()
        train_ds.set_epoch(epoch)
        lr = _cosine_lr(epoch, epochs, pol.warmup_epochs, pol.learning_rate)
        for g in optim.param_groups:
            g["lr"] = lr

        train_loss, train_top1, train_top5 = _run_epoch(
            model=model,
            loader=train_loader,
            optim=optim,
            loss_fn=loss_fn,
            device=device,
            scaler=scaler,
            use_amp=pol.use_amp,
        )
        val_loss, val_top1, val_top5 = _run_epoch(
            model=model,
            loader=val_loader,
            optim=None,
            loss_fn=loss_fn,
            device=device,
            scaler=None,
            use_amp=pol.use_amp,
        )
        dt = time.monotonic() - t0

        stats = EpochStats(
            epoch=epoch,
            train_loss=train_loss,
            train_top1=train_top1,
            train_top5=train_top5,
            val_loss=val_loss,
            val_top1=val_top1,
            val_top5=val_top5,
            seconds=dt,
        )
        history.stats.append(stats)

        log_fn(
            f"epoch {epoch:>3} | lr {lr:.2e} | "
            f"train loss {train_loss:.3f} top1 {train_top1 * 100:5.2f}% top5 {train_top5 * 100:5.2f}% | "
            f"val loss {val_loss:.3f} top1 {val_top1 * 100:5.2f}% top5 {val_top5 * 100:5.2f}% | "
            f"{dt:5.1f}s"
        )

        _save_checkpoint(
            path=last_ckpt,
            model=model,
            optim=optim,
            epoch=epoch,
            history=history,
            classes=classes,
        )
        if val_top5 > history.best_top5:
            history.best_top5 = val_top5
            history.best_epoch = epoch
            _save_checkpoint(
                path=best_ckpt,
                model=model,
                optim=optim,
                epoch=epoch,
                history=history,
                classes=classes,
            )
            log_fn(f"  new best top-5 = {val_top5 * 100:.2f}% → saved {best_ckpt.name}")

        # Early stopping: if `patience` epochs have passed without improvement
        # to best top-5, stop. The scale-test data showed val plateaus by
        # epoch ~17/50, so the back half is essentially wasted training time.
        if patience is not None and patience > 0 and history.best_epoch >= 0:
            since_best = epoch - history.best_epoch
            if since_best >= patience:
                log_fn(
                    f"  early stop: {since_best} epochs since best top-5 "
                    f"(patience {patience})"
                )
                break

    log_fn(
        f"done. best top-5 = {history.best_top5 * 100:.2f}% "
        f"at epoch {history.best_epoch} → {best_ckpt}"
    )
    return best_ckpt
