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

import logging
import math
import random
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader
from tqdm.auto import tqdm

from .classes import load_classes
from .config import CHECKPOINT_DIR, SYNTH_POLICY, TRAIN_POLICY, VAL_POLICY
from .dataset import SyntheticKanjiDataset
from .model import build_model, param_count, select_device, smoke_forward


# ---------- logging ----------------------------------------------------- #


class _TqdmLogHandler(logging.Handler):
    """Logging handler that prints via ``tqdm.write`` so log lines don't
    tear the active progress bar. Falls back to plain stdout when no bar
    is active — tqdm.write handles both."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            tqdm.write(self.format(record), file=sys.stdout)
        except Exception:  # pragma: no cover — never let logging crash training
            self.handleError(record)


def _setup_logger(ckpt_dir: Path) -> logging.Logger:
    """Configure the training logger.

    Tees ``logging.INFO`` records to two sinks:

    * stdout via ``_TqdmLogHandler`` — coexists with the per-epoch tqdm
      progress bar without smearing it.
    * ``ckpt_dir/training.log`` — append mode, timestamped, so the
      file accumulates across runs and survives terminal crashes.

    Idempotent: re-invocation in the same process replaces the handlers
    rather than stacking them (matters for notebook re-imports).
    """
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("tools.handwriting_ocr.train")
    for h in list(logger.handlers):
        logger.removeHandler(h)
        h.close()
    logger.setLevel(logging.INFO)
    logger.propagate = False

    stream = _TqdmLogHandler()
    stream.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(stream)

    fh = logging.FileHandler(ckpt_dir / "training.log", mode="a", encoding="utf-8")
    fh.setFormatter(
        logging.Formatter("%(asctime)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    )
    logger.addHandler(fh)

    return logger


# ---------- bookkeeping ------------------------------------------------- #


@dataclass
class EpochStats:
    epoch: int
    train_loss: float
    train_top1: float
    train_top5: float
    # Validation runs on a subset of epochs (see TrainPolicy.val_every_n_epochs)
    # — None when the epoch was train-only.
    val_loss: float | None
    val_top1: float | None
    val_top5: float | None
    seconds: float


@dataclass
class RunHistory:
    stats: list[EpochStats] = field(default_factory=list)
    # best.pt is selected on **top-1**, not top-5: on the clean
    # deployment-proxy val set top-5 saturates at 100% almost immediately, so
    # it can't discriminate between checkpoints (and would freeze best.pt /
    # trip early-stopping while top-1 is still improving). best_top5 is kept
    # purely for logging.
    best_top1: float = 0.0
    best_top5: float = 0.0
    best_epoch: int = -1


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    mps = getattr(torch, "mps", None)
    if mps is not None and hasattr(mps, "manual_seed"):
        mps.manual_seed(seed)


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
    desc: str = "",
) -> tuple[float, float, float]:
    """Returns (mean_loss, top1_acc, top5_acc).

    Drives a per-batch tqdm progress bar with running loss / top-1 / top-5
    in the postfix and ETA in the bar prefix. The bar is closed when the
    epoch ends so the next stage gets a clean line.
    """
    training = optim is not None
    model.train(training)
    total_loss = 0.0
    n_samples = 0
    correct = {1: 0, 5: 0}

    pbar = tqdm(
        loader,
        desc=desc,
        unit="batch",
        dynamic_ncols=True,
        leave=False,
        mininterval=0.5,
    )
    for x, y in pbar:
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

        # tqdm rate-limits its redraw at mininterval=0.5s, so this is cheap.
        pbar.set_postfix(
            loss=f"{total_loss / n_samples:.3f}",
            top1=f"{correct[1] / n_samples * 100:.1f}%",
            top5=f"{correct[5] / n_samples * 100:.1f}%",
            refresh=False,
        )

    pbar.close()
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
    arch: str,
    image_size: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model_state": model.state_dict(),
            "optim_state": optim.state_dict(),
            "epoch": epoch,
            "history": history,
            "classes": classes,
            # Self-describing so export/eval don't have to guess the trunk
            # shape or the input resolution the weights were trained for.
            "arch": arch,
            "image_size": image_size,
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
    arch: str = "simple_resnet",
    num_workers: int | None = None,
    patience: int | None = None,
    val_every: int | None = None,
    device: str | None = None,
) -> Path:
    """Run training to completion. Returns the path of the best checkpoint."""
    pol = TRAIN_POLICY
    epochs = epochs or pol.epochs
    batch_size = batch_size or pol.batch_size
    val_every = max(1, val_every or pol.val_every_n_epochs)

    _seed_everything(pol.seed)
    # CUDA → Apple MPS (Mac) → CPU, unless overridden via --device.
    device = select_device(device)

    # Per-arch checkpoint dirs so consecutive experiments don't clobber each
    # other's best models, but the default arch keeps the original path.
    ckpt_dir = CHECKPOINT_DIR if arch == "mobilenet_v3_small" else CHECKPOINT_DIR / arch
    last_ckpt = ckpt_dir / "last.pt"
    best_ckpt = ckpt_dir / "best.pt"

    logger = _setup_logger(ckpt_dir)
    logger.info(
        f"=== training run started | arch={arch} | epochs={epochs} | "
        f"batch={batch_size} | device={device.type} | log={ckpt_dir / 'training.log'}"
    )

    classes = load_classes()
    if limit_classes is not None and limit_classes < len(classes):
        classes = classes[:limit_classes]
        logger.info(f"limit-classes: truncating to first {len(classes):,}")
    logger.info(f"classes: {len(classes):,}")

    samples = samples_per_class or pol.samples_per_class_per_epoch
    # Train and val use DIFFERENT distributions: SYNTH_POLICY is the heavier
    # training regime; VAL_POLICY is the deployment proxy (clean stylus
    # strokes), so best.pt is selected on what the app actually feeds.
    train_ds = SyntheticKanjiDataset(
        classes,
        samples_per_class=samples,
        base_seed=pol.seed,
        deterministic=False,
        policy=SYNTH_POLICY,
    )
    val_ds = SyntheticKanjiDataset(
        classes,
        samples_per_class=pol.val_samples_per_class,
        base_seed=pol.seed ^ 0xDEADBEEF,
        deterministic=True,
        policy=VAL_POLICY,
    )
    logger.info(
        f"data: {train_ds.font_count} JP fonts, "
        f"KanjiVG covers {train_ds.kanjivg_coverage * 100:.1f}% of classes"
    )
    logger.info(
        f"image_size={SYNTH_POLICY.image_size}; "
        f"train p_kanjivg={SYNTH_POLICY.p_kanjivg}; "
        f"val=deployment proxy (clean strokes, p_kanjivg={VAL_POLICY.p_kanjivg})"
    )

    workers = num_workers if num_workers is not None else pol.num_workers
    logger.info(
        f"data loader: num_workers={workers} "
        f"({'override' if num_workers is not None else 'TrainPolicy default'})"
    )
    logger.info(f"validation: every {val_every} epoch(s) (+ epoch 0 + final epoch)")
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
    logger.info(f"model: arch={arch}, {param_count(model) / 1e6:.2f}M params")
    logger.info(f"smoke forward: {smoke_forward(model, image_size=SYNTH_POLICY.image_size)}")

    optim = torch.optim.AdamW(
        model.parameters(),
        lr=pol.learning_rate,
        weight_decay=pol.weight_decay,
    )
    loss_fn = nn.CrossEntropyLoss(label_smoothing=pol.label_smoothing)
    # AMP is CUDA-only; MPS/CPU train in fp32 (scaler=None → _run_epoch takes
    # the plain backward/step path).
    scaler = (
        torch.amp.GradScaler("cuda")
        if pol.use_amp and device.type == "cuda"
        else None
    )

    history = RunHistory()
    start_epoch = 0

    if resume and last_ckpt.exists():
        start_epoch, history = _load_checkpoint(last_ckpt, model=model, optim=optim)
        start_epoch += 1
        # Back-compat: checkpoints saved before top-1 became the selection
        # metric have no best_top1. Reset it so the first post-resume
        # validation re-establishes best.pt on the top-1 criterion (rather
        # than leaving best.pt frozen at the old top-5-selected epoch).
        if not hasattr(history, "best_top1"):
            history.best_top1 = 0.0
        logger.info(
            f"resumed from epoch {start_epoch} "
            f"(best top-1 so far: {history.best_top1 * 100:.2f}%)"
        )

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
            desc=f"epoch {epoch:>3} train",
        )

        # Validate on epoch 0 (baseline), every val_every epochs, and the
        # final epoch. The final-epoch guard ensures best.pt reflects the
        # full run even when epochs % val_every != 0.
        do_val = (
            epoch % val_every == 0
            or epoch == epochs - 1
        )
        val_loss: float | None = None
        val_top1: float | None = None
        val_top5: float | None = None
        if do_val:
            val_loss, val_top1, val_top5 = _run_epoch(
                model=model,
                loader=val_loader,
                optim=None,
                loss_fn=loss_fn,
                device=device,
                scaler=None,
                use_amp=pol.use_amp,
                desc=f"epoch {epoch:>3} val  ",
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

        line = (
            f"epoch {epoch:>3} | lr {lr:.2e} | "
            f"train loss {train_loss:.3f} "
            f"top1 {train_top1 * 100:5.2f}% top5 {train_top5 * 100:5.2f}%"
        )
        if do_val:
            line += (
                f" | val loss {val_loss:.3f} "
                f"top1 {val_top1 * 100:5.2f}% top5 {val_top5 * 100:5.2f}%"
            )
        else:
            line += f" | val skipped (next in {val_every - epoch % val_every} ep)"
        line += f" | {dt:5.1f}s"
        logger.info(line)

        _save_checkpoint(
            path=last_ckpt,
            model=model,
            optim=optim,
            epoch=epoch,
            history=history,
            classes=classes,
            arch=arch,
            image_size=SYNTH_POLICY.image_size,
        )
        if do_val and val_top1 is not None:
            # Track best top-5 for logging only; SELECT on top-1.
            if val_top5 is not None and val_top5 > history.best_top5:
                history.best_top5 = val_top5
            if val_top1 > history.best_top1:
                history.best_top1 = val_top1
                history.best_epoch = epoch
                _save_checkpoint(
                    path=best_ckpt,
                    model=model,
                    optim=optim,
                    epoch=epoch,
                    history=history,
                    classes=classes,
                    arch=arch,
                    image_size=SYNTH_POLICY.image_size,
                )
                logger.info(
                    f"  new best top-1 = {val_top1 * 100:.2f}% "
                    f"(top-5 {val_top5 * 100:.2f}%) -> saved {best_ckpt.name}"
                )

        # Early stopping: if `patience` epochs have passed without improvement
        # to best top-1, stop. Note the count is in *all* epochs, not just
        # validated ones — with val_every>1, set patience >= val_every * 2
        # or the run can stop right after a single non-improving val cycle.
        if patience is not None and patience > 0 and history.best_epoch >= 0:
            since_best = epoch - history.best_epoch
            if since_best >= patience:
                logger.info(
                    f"  early stop: {since_best} epochs since best top-1 "
                    f"(patience {patience})"
                )
                break

    logger.info(
        f"done. best top-1 = {history.best_top1 * 100:.2f}% "
        f"(top-5 {history.best_top5 * 100:.2f}%) at epoch {history.best_epoch} -> {best_ckpt}"
    )
    return best_ckpt
