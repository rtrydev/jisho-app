"""Head-to-head evaluation of recognizer checkpoints.

Scores a *candidate* checkpoint against a *baseline* on deterministically
seeded synthetic samples, under named conditions. The default condition is the
DEPLOYMENT proxy (``VAL_POLICY``): clean stylus-style strokes with moderate
geometric sloppiness — i.e. what ``app/lib/handwriting/preprocess.ts`` actually
feeds the model. This is the metric that should gate shipping.

Why this exists: an earlier run was selected on a validation set dominated by
print fonts + ink/cutout noise the canvas never produces, and lost badly on real
clean strokes. ``eval`` makes "does the candidate beat what's shipped, on the
right distribution?" a one-command check for every future run.

Cross-resolution fairness: each model is scored on its OWN native-size rendering
of the same seeded sample. The per-sample RNG draws (path choice, stroke
perturbation, affine/elastic seeds) are independent of ``image_size`` — only the
final rasterization resolution differs — so sample ``i`` is the *same character
with the same geometric skew* for both models, just rendered at each model's
resolution. That makes a 96px candidate directly comparable to a 64px baseline,
including the per-sample agreement table.
"""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from tqdm.auto import tqdm

from .config import (
    CHECKPOINT_DIR,
    SYNTH_POLICY,
    TRAIN_POLICY,
    VAL_POLICY,
    SynthesisPolicy,
)
from .dataset import SyntheticKanjiDataset
from .model import build_model, param_count

# Same seed the training driver pins its validation split to, so `eval`
# reproduces the in-loop val numbers exactly.
VAL_SEED = TRAIN_POLICY.seed ^ 0xDEADBEEF

# Default baseline = a backup of the currently-deployed checkpoint. The
# train/ship flow copies the old best.pt here before retraining overwrites it.
DEPLOYED_BASELINE = CHECKPOINT_DIR / "deployed_baseline.pt"

CONDITIONS_HELP = {
    "deployment": "clean stylus strokes + moderate skew (the ship gate)",
    "clean": "canonical glyphs, no skew (ceiling)",
    "train": "the heavy training distribution",
}


def _detect_arch(state_dict: dict) -> str:
    keys = list(state_dict.keys())
    if any(k.startswith("stem.") for k in keys):
        return "simple_resnet"
    if any(k.startswith("features.") for k in keys):
        return "mobilenet_v3_small"
    raise RuntimeError(f"cannot detect arch from checkpoint keys: {keys[:4]}")


def _default_ckpt(arch: str) -> Path:
    ckpt_dir = CHECKPOINT_DIR if arch == "mobilenet_v3_small" else CHECKPOINT_DIR / arch
    return ckpt_dir / "best.pt"


def _load(
    path: Path,
    *,
    device: torch.device,
    default_image_size: int,
    arch_override: str | None = None,
    image_size_override: int | None = None,
):
    if not path.exists():
        raise FileNotFoundError(f"checkpoint not found: {path}")
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    classes = list(ckpt["classes"])
    arch = arch_override or ckpt.get("arch") or _detect_arch(ckpt["model_state"])
    image_size = image_size_override or int(ckpt.get("image_size", default_image_size))
    model = build_model(num_classes=len(classes), arch=arch)  # type: ignore[arg-type]
    model.load_state_dict(ckpt["model_state"])
    model.eval().to(device)
    return model, classes, arch, image_size


def _conditions() -> dict[str, SynthesisPolicy]:
    clean = replace(
        VAL_POLICY,
        stroke_jitter_px=0.0,
        stroke_local_shift_px=0.0,
        stroke_local_rotate_deg=0.0,
        affine_rotate_deg=0.0,
        affine_scale_min=1.0,
        affine_scale_max=1.0,
        affine_shear_deg=0.0,
        affine_translate_frac=0.0,
        elastic_alpha=0.0,
        p_blur=0.0,
    )
    return {"deployment": VAL_POLICY, "clean": clean, "train": SYNTH_POLICY}


@torch.no_grad()
def _score(
    model: torch.nn.Module,
    classes: list[str],
    policy: SynthesisPolicy,
    image_size: int,
    *,
    samples_per_class: int,
    workers: int,
    device: torch.device,
    label: str,
    batch_size: int = 512,
) -> dict:
    ds = SyntheticKanjiDataset(
        classes,
        samples_per_class=samples_per_class,
        base_seed=VAL_SEED,
        deterministic=True,
        policy=replace(policy, image_size=image_size),
    )
    loader = DataLoader(
        ds,
        batch_size=batch_size,
        shuffle=False,
        num_workers=workers,
        pin_memory=device.type == "cuda",
        persistent_workers=workers > 0,
        prefetch_factor=4 if workers > 0 else None,
    )
    n = c1 = c5 = 0
    correct1: list[torch.Tensor] = []
    for x, y in tqdm(loader, desc=f"    {label}@{image_size}", unit="batch", leave=False):
        x = x.to(device, non_blocking=True)
        y = y.to(device, non_blocking=True)
        with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
            logits = model(x)
        _, pred5 = logits.topk(5, dim=1)
        hit = pred5.eq(y.unsqueeze(1))
        c1 += int(hit[:, :1].any(1).sum())
        c5 += int(hit.any(1).sum())
        n += int(y.numel())
        correct1.append(hit[:, 0].cpu())
    return {"n": n, "top1": c1 / n, "top5": c5 / n, "correct1": torch.cat(correct1)}


def run(
    *,
    arch: str = "simple_resnet",
    candidate: str | None = None,
    candidate_image_size: int | None = None,
    baseline: str | None = None,
    baseline_arch: str | None = None,
    baseline_image_size: int | None = None,
    condition: str = "deployment",
    samples_per_class: int = 6,
    num_workers: int = 4,
    log_fn=print,
) -> int:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    cand_path = Path(candidate) if candidate else _default_ckpt(arch)
    cand_model, cand_classes, cand_arch, cand_size = _load(
        cand_path,
        device=device,
        default_image_size=SYNTH_POLICY.image_size,
        arch_override=arch if candidate is None else None,
        image_size_override=candidate_image_size,
    )

    base_path = Path(baseline) if baseline else DEPLOYED_BASELINE
    if not base_path.exists():
        log_fn(
            f"!! baseline checkpoint not found: {base_path}\n"
            "   Back up the deployed checkpoint there, or pass --baseline <path>.\n"
            "   (The ship flow copies checkpoints/simple_resnet/best.pt → "
            "deployed_baseline.pt before retraining.)"
        )
        return 1
    base_model, base_classes, base_arch, base_size = _load(
        base_path,
        device=device,
        default_image_size=64,  # the deployed model predates the image_size field
        arch_override=baseline_arch,
        image_size_override=baseline_image_size,
    )

    if cand_classes != base_classes:
        log_fn(
            f"!! class lists differ (candidate={len(cand_classes)}, "
            f"baseline={len(base_classes)}) — indices wouldn't align. Aborting."
        )
        return 1
    classes = cand_classes

    log_fn(f"device={device.type}  classes={len(classes):,}  seed={VAL_SEED}")
    log_fn(
        f"  candidate: {cand_arch}@{cand_size}  "
        f"{param_count(cand_model) / 1e6:.2f}M  ({cand_path})"
    )
    log_fn(
        f"  baseline : {base_arch}@{base_size}  "
        f"{param_count(base_model) / 1e6:.2f}M  ({base_path})"
    )

    conds = _conditions()
    selected = list(conds) if condition == "all" else [condition]
    for name in selected:
        if name not in conds:
            log_fn(f"!! unknown condition {name!r}; choose from {list(conds)} or 'all'")
            return 1
        policy = conds[name]
        cand = _score(
            cand_model, classes, policy, cand_size, label="cand",
            samples_per_class=samples_per_class, workers=num_workers, device=device,
        )
        base = _score(
            base_model, classes, policy, base_size, label="base",
            samples_per_class=samples_per_class, workers=num_workers, device=device,
        )
        a, b = cand["correct1"], base["correct1"]
        both = int((a & b).sum())
        neither = int((~a & ~b).sum())
        cand_only = int((a & ~b).sum())
        base_only = int((b & ~a).sum())

        log_fn(f"\n=== condition: {name}  ({CONDITIONS_HELP[name]})  n={cand['n']:,} ===")
        log_fn(f"  candidate: top-1 {cand['top1']*100:6.2f}%   top-5 {cand['top5']*100:6.2f}%")
        log_fn(f"  baseline : top-1 {base['top1']*100:6.2f}%   top-5 {base['top5']*100:6.2f}%")
        log_fn(
            f"  delta (cand - base): top-1 {(cand['top1']-base['top1'])*100:+.2f} pts   "
            f"top-5 {(cand['top5']-base['top5'])*100:+.2f} pts"
        )
        res_note = "" if cand_size == base_size else f"  [native res differs: {cand_size} vs {base_size}]"
        log_fn(
            f"  top-1 agreement: both={both:,}  neither={neither:,}  "
            f"candidate_only={cand_only:,}  baseline_only={base_only:,}{res_note}"
        )
    return 0
