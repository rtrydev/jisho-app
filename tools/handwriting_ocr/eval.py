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

import random
from dataclasses import replace
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from tqdm.auto import tqdm

from .augment import augment
from .kanjivg import rasterize_with_perturbation

from .config import (
    CHECKPOINT_DIR,
    SYNTH_POLICY,
    TRAIN_POLICY,
    VAL_POLICY,
    SynthesisPolicy,
    is_kana,
)
from .dataset import SyntheticKanjiDataset
from .fonts import discover_japanese_fonts, filter_font_faces, rasterize_with_font
from .model import build_model, param_count, select_device

# Same seed the training driver pins its validation split to, so `eval`
# reproduces the in-loop val numbers exactly.
VAL_SEED = TRAIN_POLICY.seed ^ 0xDEADBEEF

# Default baseline = a backup of the currently-deployed checkpoint. The
# train/ship flow copies the old best.pt here before retraining overwrites it.
DEPLOYED_BASELINE = CHECKPOINT_DIR / "deployed_baseline.pt"

CONDITIONS_HELP = {
    "deployment": "honest proxy: sharp↔soft spectrum + freehand + skew (ship gate)",
    "clean": "canonical glyphs, razor-sharp, no skew/freehand (shape ceiling)",
    "freehand": "razor-sharp + open corners + connections (real-handwriting proxy)",
    "clutter": "deployment + residual border junk forced on (camera-junk proxy)",
    "print": "fonts only, rigid + camera skew (photo-mode letterform proxy)",
    "print-bold": "print restricted to bold-sans faces (the manga-dialogue gap)",
    "print-photo": "print-bold + forced low-res + dim ink (the measured photo killers)",
    "train": "the heavy training distribution",
}

# Bold sans faces — the letterform slice photo mode reportedly fails on (bold
# gothic manga dialogue). Substring-matched against font file stems, case-
# insensitive (see fonts.filter_font_faces). Covers the bundled OFL pack plus
# the Windows training host's system faces; extend alongside font_pack.py when
# more bold-sans families are added.
PRINT_BOLD_STEMS: tuple[str, ...] = (
    "ZenMaruGothic-Bold",  # rounded sans bold (bundled pack)
    "DelaGothicOne",       # ultra-heavy display gothic (bundled pack)
    "YuGothB",             # Yu Gothic Bold (Windows system)
    "meiryob",             # Meiryo Bold (Windows system)
    # Hiragino Kaku Gothic bold weights (macOS system) — the closest installed
    # match for bold manga/print dialogue gothic.
    "ヒラギノ角ゴシック W6",
    "ヒラギノ角ゴシック W7",
    "ヒラギノ角ゴシック W8",
    "ヒラギノ角ゴシック W9",
)

# Box/hook near-homoglyph clusters tracked in RECOGNIZER_CHALLENGES.md. The
# recognizer's worst confusions live here; the per-condition cluster line in
# `run` reports how a candidate does on exactly these characters.
CONFUSION_CLUSTERS: dict[str, str] = {
    "box": "日目曰田旦円口囗",
    "hook": "己已巳弓戸",
    # Kana clusters (added with the kana class expansion — KANA_EXPANSION.md).
    # These are the kana-specific weak spots: cross-script homoglyphs that collide
    # with an existing kanji class (irreducible in isolation), dakuten
    # discrimination (か/が…), and the loopy / few-stroke hiragana + シ-family
    # confusables. Tracked run-to-run exactly like box/hook.
    "kana_xscript": "ロ口カ力エ工ニ二ハ八タ夕へヘ",
    "kana_dakuten": "かがきぎくぐけげこご",
    "kana_loop": "きさちらぬめわねれるろ",
    "kana_shi": "シツソンノ",
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
    # Canonical shape ceiling: razor-sharp, no geometric skew, no freehand
    # (must zero the new sharpness/endpoint/connection knobs too, or "clean"
    # would silently inherit VAL_POLICY's blur spectrum and open corners).
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
        endpoint_overshoot_px=0.0,
        p_connect_strokes=0.0,
        sharpness_jitter_max=0.0,
        p_blur=0.0,
    )
    # Real-handwriting proxy: razor-sharp edges (the OOD case that collapsed
    # the old model) + freehand corners/connections + the deployment skew.
    freehand = replace(
        VAL_POLICY,
        sharpness_jitter_max=0.0,
        endpoint_overshoot_px=4.0,
        p_connect_strokes=0.18,
        connect_max_px=7.0,
    )
    # Camera-junk proxy: the deployment distribution with residual clutter
    # forced ON for every sample (border marks the camera pipeline's junk
    # filtering can't remove from a cell — see NOISE_ROBUSTNESS.md). Measures
    # robustness to foreign ink; NOT the ship gate (that stays `deployment`).
    clutter = replace(VAL_POLICY, p_clutter=1.0)
    # Photo-mode letterform proxy: what the camera path actually feeds the
    # model — binarized FILLED PRINT glyphs, bbox-fit into 96² with no stroke-
    # weight normalization (app/lib/handwriting/imagePreprocess.ts). Fonts
    # only (p_kanjivg=0); print is rigid, so no elastic — geometric variety is
    # camera tilt/perspective, which VAL_POLICY's moderate affine approximates.
    # The sharpness spectrum stays (camera focus varies; the pipeline's σ≈0.5
    # blur sits inside it). faux_bold/morphology stay 0 (inherited) so each
    # face is measured at its natural weight, and clutter stays 0 — the
    # `clutter` condition measures that axis separately. The stroke-path
    # freehand knobs (endpoint/connection/jitter) are inert on the font path.
    print_pol = replace(VAL_POLICY, p_kanjivg=0.0, p_elastic=0.0)
    # The slice of `print` photo mode reportedly fails on: bold sans faces.
    print_bold = replace(print_pol, font_stem_allow=PRINT_BOLD_STEMS)
    # The measured photo-mode killers forced ON over the bold faces
    # (PHOTO_PRINT_FINDINGS.md): every sample rendered small (low-res
    # downscale-upscale) and dimmed (sub-unity gain), plus within-glyph
    # gradients. This is deliberately harsh — the model that trained without
    # the photo-appearance knobs scores low here; a retrain must raise it
    # WITHOUT regressing `deployment` (the ship gate) or `print`.
    print_photo = replace(
        print_bold,
        p_lowres=1.0,
        lowres_min_px=28,
        lowres_max_px=64,
        ink_gain_min=0.45,
        ink_gain_max=0.85,
        p_ink_grain=0.5,
        ink_grain_strength=0.25,
    )
    return {
        "deployment": VAL_POLICY,
        "clean": clean,
        "freehand": freehand,
        "clutter": clutter,
        "print": print_pol,
        "print-bold": print_bold,
        "print-photo": print_photo,
        "train": SYNTH_POLICY,
    }


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


@torch.no_grad()
def _cluster_report(
    model: torch.nn.Module,
    classes: list[str],
    policy: SynthesisPolicy,
    image_size: int,
    *,
    device: torch.device,
    n: int = 16,
) -> dict[str, tuple[float, float]]:
    """Per-cluster (top-1, mean self-confidence) on the box/hook homoglyphs.

    Renders only the cluster characters (deterministically seeded) and runs
    them through the full softmax — so a confusion *into* another class still
    counts as a miss. This is the headline diagnostic for the recognizer's
    documented weakness; track it run-to-run."""
    model.eval()
    idx_of = {c: i for i, c in enumerate(classes)}
    pol = replace(policy, image_size=image_size)
    out: dict[str, tuple[float, float]] = {}
    for name, chars in CONFUSION_CLUSTERS.items():
        present = [c for c in chars if c in idx_of]
        confs: list[float] = []
        hits = 0
        total = 0
        for ch in present:
            gi = idx_of[ch]
            for s in range(n):
                rng = random.Random(0xC0FFEE ^ (gi * 1009) ^ s)
                arr = rasterize_with_perturbation(ch, image_size, rng=rng, policy=pol)
                if arr is None:
                    continue
                arr = augment(arr, rng, pol)
                x = torch.from_numpy(arr)[None, None].to(device)
                p = torch.softmax(model(x)[0], 0)
                confs.append(float(p[gi]))
                hits += int(int(p.argmax()) == gi)
                total += 1
        out[name] = (
            (hits / total if total else 0.0),
            (float(np.mean(confs)) if confs else 0.0),
        )
    return out


def _face_label(path: Path, face_idx: int) -> str:
    return f"{path.stem}#{face_idx}" if path.suffix.lower() == ".ttc" else path.stem


def _char_seed(ch: str, s: int) -> int:
    # Stable across processes (unlike hash(str), which is salted).
    return VAL_SEED ^ (ord(ch) * 2654435761) ^ (s * 97)


@torch.no_grad()
def _font_report(
    model: torch.nn.Module,
    classes: list[str],
    policy: SynthesisPolicy,
    image_size: int,
    *,
    device: torch.device,
    chars_per_face: int = 48,
    samples: int = 2,
) -> list[tuple[str, float, int]]:
    """Per-font-face top-1 under a fonts-only policy, worst face first.

    The same deterministic character sample + per-(char, sample) seeds are used
    for every face and every model, so rows are directly comparable. Glyphs a
    face doesn't cover (``rasterize_with_font`` renders empty) are skipped, not
    counted as misses — ``n`` reports what actually rendered. Kanji only: kana
    train under their own dampened policy and aren't the letterform gap being
    attributed here."""
    model.eval()
    faces = filter_font_faces(discover_japanese_fonts(), policy.font_stem_allow)
    pol = replace(policy, image_size=image_size)
    pool = [c for c in classes if not is_kana(c)]
    rng = random.Random(VAL_SEED)
    chars = rng.sample(pool, min(chars_per_face, len(pool)))
    idx_of = {c: i for i, c in enumerate(classes)}
    out: list[tuple[str, float, int]] = []
    for path, face_idx in faces:
        xs: list[np.ndarray] = []
        ys: list[int] = []
        for ch in chars:
            for s in range(samples):
                r = random.Random(_char_seed(ch, s))
                arr = rasterize_with_font(
                    ch, path, image_size, index=face_idx, rng=r, policy=pol
                )
                if arr.max() <= 0:
                    continue  # face lacks this glyph
                xs.append(augment(arr, r, pol))
                ys.append(idx_of[ch])
        if not xs:
            out.append((_face_label(path, face_idx), 0.0, 0))
            continue
        x = torch.from_numpy(np.stack(xs))[:, None].to(device)
        y = torch.tensor(ys, device=device)
        hits = int((model(x).argmax(1) == y).sum())
        out.append((_face_label(path, face_idx), hits / len(ys), len(ys)))
    out.sort(key=lambda r: r[1])
    return out


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
    device = select_device()  # CUDA → Apple MPS (Mac) → CPU

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
        # Fonts-only conditions render nothing without a font pool — and the
        # dataset would silently fall back to strokes, which is exactly the
        # dishonest measurement these conditions exist to prevent.
        is_print = policy.p_kanjivg <= 0.0
        if is_print and not filter_font_faces(
            discover_japanese_fonts(), policy.font_stem_allow
        ):
            log_fn(
                f"\n!! condition {name!r} renders from fonts but none matched "
                f"(filter={list(policy.font_stem_allow) or 'none'}).\n"
                "   Run `python -m tools.handwriting_ocr fetch-fonts`, then check "
                "`fonts --list`."
            )
            if condition == "all":
                continue
            return 1
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
        if is_print:
            # Per-face attribution table (replaces the cluster lines, which
            # render from KanjiVG strokes and would mislabel a print condition).
            cand_faces = _font_report(
                cand_model, classes, policy, cand_size, device=device
            )
            base_faces = {
                lbl: t1
                for lbl, t1, _n in _font_report(
                    base_model, classes, policy, base_size, device=device
                )
            }
            log_fn(f"  per-face top-1 (worst first; {len(cand_faces)} faces):")
            for lbl, t1, n in cand_faces:
                bt1 = base_faces.get(lbl, 0.0)
                log_fn(
                    f"    {lbl:<36} cand {t1*100:5.1f}%   "
                    f"base {bt1*100:5.1f}%   (n={n})"
                )
            continue
        # Confusion-cluster diagnostic — the headline weakness (box/hook
        # homoglyphs). top-1 / mean self-confidence on just those characters.
        cand_cl = _cluster_report(cand_model, classes, policy, cand_size, device=device)
        base_cl = _cluster_report(base_model, classes, policy, base_size, device=device)
        for cl in CONFUSION_CLUSTERS:
            ct1, ccf = cand_cl[cl]
            bt1, bcf = base_cl[cl]
            log_fn(
                f"  cluster[{cl:>4}]: cand top-1 {ct1*100:5.1f}% conf {ccf*100:5.1f}%"
                f"   base top-1 {bt1*100:5.1f}% conf {bcf*100:5.1f}%"
            )
    return 0
