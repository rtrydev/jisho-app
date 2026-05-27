"""Handwriting OCR — pipeline configuration.

All policy knobs live here so runs are reproducible and diffable. The CLI
exposes only the few knobs you'd legitimately change between runs
(``--epochs``, ``--batch-size``); everything else is set here.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
PUBLIC_DIR = REPO_ROOT / "public"
OUTPUT_DIR = PUBLIC_DIR / "data"
WORK_DIR = REPO_ROOT / ".handwriting-work"

JMDICT_PATH = DATA_DIR / "JMdict_e.gz"

# Subdirectories of WORK_DIR.
KANJIVG_DIR = WORK_DIR / "kanjivg"
KANJIVG_ARCHIVE = WORK_DIR / "kanjivg.zip"
CHECKPOINT_DIR = WORK_DIR / "checkpoints"

# Shipped artifacts.
CLASSES_OUT = OUTPUT_DIR / "kanji-classes.json"
MODEL_OUT = OUTPUT_DIR / "kanji-recognizer.onnx"
MODEL_FP32_OUT = WORK_DIR / "kanji-recognizer.fp32.onnx"

# KanjiVG release source. Pinned to a specific tag; bump deliberately.
# Verify the tag at https://github.com/KanjiVG/kanjivg/releases — releases
# use tag `rYYYYMMDD` but assets drop the `r` prefix
# (e.g. tag `r20250816` → asset `kanjivg-20250816-main.zip`).
KANJIVG_TAG = "r20250816"
KANJIVG_URL = (
    f"https://github.com/KanjiVG/kanjivg/releases/download/{KANJIVG_TAG}/"
    f"kanjivg-{KANJIVG_TAG[1:]}-main.zip"
)


@dataclass(frozen=True)
class ClassPolicy:
    """How the recognized character set is chosen."""

    # Restrict to JIS X 0208 L1+L2 (stable Unicode-defined ceiling). When
    # False, mines all CJK Unified Ideographs from JMdict — gives broader
    # coverage but the class index isn't stable across JMdict snapshots.
    restrict_to_jis_x_0208: bool = True

    # Hard cap on class count. ~6,355 in JIS X 0208 L1+L2; intersection with
    # JMdict typically lands at ~5,500–6,000.
    max_classes: int = 6500

    # Drop characters seen in fewer than this many JMdict headwords. 1 keeps
    # everything seen at least once; 2 drops single-mention hapax kanji that
    # tend to bloat the class set without being practically useful.
    min_jmdict_occurrences: int = 1


@dataclass(frozen=True)
class SynthesisPolicy:
    """How a single training sample is synthesized."""

    image_size: int = 64
    # Probability of using the KanjiVG vector-perturbation path vs. the font
    # rasterization path for any given sample. KanjiVG produces more
    # handwriting-like exemplars; fonts produce more print-like ones — both
    # are useful, mixing matters more than the exact ratio.
    p_kanjivg: float = 0.5

    # Per-stroke perturbation (KanjiVG path).
    stroke_jitter_px: float = 1.8         # Gaussian std on control points
    stroke_thickness_min: float = 1.8
    stroke_thickness_max: float = 4.2
    stroke_thickness_vary: float = 0.6    # within a single drawing
    p_drop_stroke: float = 0.05           # simulate skipped stroke
    p_extra_stroke: float = 0.02          # simulate extraneous mark

    # Global affine (applied to both paths).
    affine_rotate_deg: float = 10.0
    affine_scale_min: float = 0.85
    affine_scale_max: float = 1.15
    affine_shear_deg: float = 8.0
    affine_translate_frac: float = 0.06

    # Image-space augmentation (applied to both paths).
    # Softened values from the original heavy regime. The font-filtered
    # data has less inherent noise, so over-aggressive augmentation now
    # hurts more than it helps. Compare the "original heavy" values in
    # git history (elastic_alpha=8.0, p_pixel_dropout=0.5, etc.).
    elastic_alpha: float = 4.0
    elastic_sigma: float = 4.0
    p_dilate: float = 0.3
    p_erode: float = 0.1
    p_pixel_dropout: float = 0.2
    pixel_dropout_frac: float = 0.01
    gaussian_noise_std: float = 0.02
    p_blur: float = 0.1
    blur_radius_max: float = 0.8


@dataclass(frozen=True)
class TrainPolicy:
    """Training schedule + optimizer."""

    epochs: int = 30
    batch_size: int = 256
    samples_per_class_per_epoch: int = 80
    val_samples_per_class: int = 8

    learning_rate: float = 3e-3
    weight_decay: float = 1e-4
    label_smoothing: float = 0.1
    warmup_epochs: int = 1

    # DataLoader. 0 on Windows is the safe default for multiprocessing
    # weirdness; bump on Linux.
    num_workers: int = 0
    pin_memory: bool = True

    # Reproducibility.
    seed: int = 20260526

    # Mixed-precision (CUDA only — falls back to fp32 silently on CPU).
    use_amp: bool = True


@dataclass(frozen=True)
class ExportPolicy:
    """ONNX export + quantization."""

    opset: int = 17
    # Dynamic quantization is simplest and works without a calibration set.
    # Static quantization would buy ~10% more accuracy but needs a real
    # calibration loop — defer until the MVP ships.
    quantization: str = "dynamic"  # one of: "dynamic", "fp16", "none"


CLASS_POLICY = ClassPolicy()
SYNTH_POLICY = SynthesisPolicy()
TRAIN_POLICY = TrainPolicy()
EXPORT_POLICY = ExportPolicy()
