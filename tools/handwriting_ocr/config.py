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
# Curated OFL font pack downloaded by ``font_pack.fetch_fonts``. Picked
# up by ``fonts.discover_japanese_fonts`` alongside system fonts so a
# clean CI box still trains on the same style diversity.
BUNDLED_FONTS_DIR = WORK_DIR / "fonts"

# Shipped artifacts.
CLASSES_OUT = OUTPUT_DIR / "kanji-classes.json"
MODEL_OUT = OUTPUT_DIR / "kanji-recognizer.onnx"
MODEL_FP32_OUT = WORK_DIR / "kanji-recognizer.fp32.onnx"

# Character-boundary segmenter (a separate, small model — see segment_*.py).
# It splits a multi-character drawing into single-character regions so the
# recognizer above can run per character; the recognizer itself is unchanged.
SEGMENTER_OUT = OUTPUT_DIR / "kanji-segmenter.onnx"
SEGMENTER_FP32_OUT = WORK_DIR / "kanji-segmenter.fp32.onnx"
SEGMENTER_CHECKPOINT_DIR = WORK_DIR / "seg-checkpoints"

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
    """How a single training sample is synthesized.

    The defaults here are the **training** distribution. ``VAL_POLICY`` below
    overrides them for the validation split. They are deliberately different:
    train is heavier (to generalize), val mirrors the *deployment* input.

    Design rule (learned the hard way — see the eval that compared the
    deployed simple_resnet to a font-heavy mobilenet): the app feeds the model
    **clean anti-aliased stroke line-art** from a stylus/mouse canvas
    (``app/lib/handwriting/preprocess.ts``). It never produces filled print
    glyphs, ink bleed, paper grain, cutout, or pixel dropout. So those
    "artifact" augmentations are OFF here — they only teach robustness to
    inputs that can't occur, at the cost of clean-stroke accuracy. What we DO
    lean on instead is geometric variety: many ways of skewing the same
    skeleton (per-stroke wobble + anisotropic affine + elastic).

    Pixel-denominated knobs are at the configured ``image_size`` (96).
    The KanjiVG ``stroke_*`` knobs are in KanjiVG **viewport** units (~109),
    applied before the strokes are fit into the image, so they are
    independent of ``image_size``.
    """

    image_size: int = 96

    # Probability of the KanjiVG stroke path vs. the font path. Strokes are
    # what a stylus actually produces, so the mix is stroke-dominant; fonts
    # are a minority source of *shape-style* variety (kaisho / kyokasho /
    # mincho / gothic letterforms), not the main signal.
    p_kanjivg: float = 0.8

    # --- KanjiVG stroke perturbation (viewport units, ~109) ------------- #
    stroke_jitter_px: float = 2.5         # Gaussian std on each control point
    # Per-stroke rigid wobble: each stroke is independently nudged and
    # rotated about its own centroid, so the *spatial relationships* between
    # radicals/components vary — the dominant way real handwriting differs
    # from a single canonical skeleton. Global affine alone can't do this.
    stroke_local_shift_px: float = 3.0
    stroke_local_rotate_deg: float = 4.0
    p_drop_stroke: float = 0.04           # simulate skipped stroke
    p_extra_stroke: float = 0.02          # simulate extraneous mark

    # --- Stroke thickness (final-image px) ------------------------------ #
    # Wide range spanning thin mouse lines → thick finger strokes. The
    # midpoint tracks ``preprocess.ts`` STROKE_WIDTH so train and inference
    # render strokes at a consistent weight.
    stroke_thickness_min: float = 2.5
    stroke_thickness_max: float = 7.0
    stroke_thickness_vary: float = 0.8    # within a single drawing

    # --- Global affine (image-space; applied to both paths) ------------- #
    # sx and sy are sampled independently in augment.random_affine, so a
    # wide scale range already yields anisotropic (tall/wide) distortion.
    affine_rotate_deg: float = 13.0
    affine_scale_min: float = 0.80
    affine_scale_max: float = 1.20
    affine_shear_deg: float = 9.0
    affine_translate_frac: float = 0.06

    # --- Elastic warp (image-space px; nonlinear sloppiness) ------------ #
    elastic_alpha: float = 6.0
    elastic_sigma: float = 5.0

    # --- Morphology: mild stroke thicken/thin wobble -------------------- #
    p_dilate: float = 0.15
    p_erode: float = 0.10

    # --- Blur: ONLY a mild pass to mimic the canvas's 4× supersample →
    # downsample anti-aliasing. Not a denoiser. -------------------------- #
    p_blur: float = 0.25
    blur_radius_max: float = 1.2

    # --- Font-render style diversity (font path only) ------------------- #
    # Faux-bold via PIL stroke_width: one Regular face yields a few weight
    # variants for free. Kept because heavier letterforms are still valid
    # stroke shapes.
    faux_bold_max: int = 2

    # --- Print/sensor artifacts: OFF. A stylus canvas never produces these
    # (see the class docstring). Kept as fields so VAL_POLICY and the eval
    # conditions can dial them explicitly, but zero in the training mix. -- #
    p_pixel_dropout: float = 0.0
    pixel_dropout_frac: float = 0.0
    gaussian_noise_std: float = 0.0
    p_ink_bleed: float = 0.0
    ink_bleed_max_radius: float = 0.0
    p_ink_grain: float = 0.0
    ink_grain_sigma: float = 4.0
    ink_grain_strength: float = 0.0
    p_cutout: float = 0.0
    cutout_frac_max: float = 0.0


@dataclass(frozen=True)
class TrainPolicy:
    """Training schedule + optimizer."""

    epochs: int = 30
    batch_size: int = 256
    samples_per_class_per_epoch: int = 80
    val_samples_per_class: int = 8

    # Run the validation pass every N epochs. 1 = every epoch (existing
    # behaviour). Bump on long runs where a val signal every ~30 min is
    # plenty and the spared time matters. Epoch 0 and the final epoch
    # are always validated regardless, so best.pt is never stale.
    val_every_n_epochs: int = 1

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
class SegmentPolicy:
    """How a multi-character training *strip* is synthesized and how the
    boundary model is shaped. The strip is a height-normalized line of 1–4
    characters; the model predicts a 1-D heatmap that peaks at the gaps
    between adjacent characters (not at gaps *inside* a character)."""

    # Model input strip (height-normalized, content left-aligned + padded).
    strip_h: int = 64
    strip_w: int = 384
    # Width downsampling factor of the FCN → output heatmap length = strip_w // width_stride.
    width_stride: int = 4
    # Gaussian bump half-width (in output columns) placed at each true boundary.
    target_sigma: float = 2.0

    # Character-count distribution per sample (n = 1..4). A healthy share of
    # n=1 (incl. wide multi-component kanji) teaches the model NOT to cut a
    # single character at its internal gaps.
    count_weights: tuple[float, float, float, float] = (0.20, 0.34, 0.28, 0.18)

    # Per-glyph size as a fraction of strip height (scaled by the larger of
    # w/h so aspect is preserved — 一 stays short-and-wide, 川 fills the cell).
    glyph_min_frac: float = 0.58
    glyph_max_frac: float = 0.94
    # Inter-character gap as a fraction of strip height (small → hard cases).
    gap_min_frac: float = 0.05
    gap_max_frac: float = 0.45
    # Leading/trailing margin (px) and vertical jitter (fraction of height).
    margin_min: float = 2.0
    margin_max: float = 16.0
    v_jitter: float = 0.05


@dataclass(frozen=True)
class ExportPolicy:
    """ONNX export + quantization."""

    opset: int = 17
    # Dynamic quantization is simplest and works without a calibration set.
    # Static quantization would buy ~10% more accuracy but needs a real
    # calibration loop — defer until the MVP ships.
    quantization: str = "dynamic"  # one of: "dynamic", "fp16", "none"


CLASS_POLICY = ClassPolicy()
SEGMENT_POLICY = SegmentPolicy()
# Training distribution (heavier, for generalization).
SYNTH_POLICY = SynthesisPolicy()
# Validation distribution = the DEPLOYMENT proxy. This is what selects
# best.pt, so the chosen checkpoint is the one that does best on what the app
# actually feeds the model: clean stroke line-art (KanjiVG only, no print
# artifacts) with moderate, realistic geometric sloppiness. The stroke-width
# midpoint (3.5–5.5 → 4.5) matches preprocess.ts STROKE_WIDTH at 96px.
VAL_POLICY = SynthesisPolicy(
    p_kanjivg=1.0,
    stroke_jitter_px=1.5,
    stroke_local_shift_px=1.5,
    stroke_local_rotate_deg=2.0,
    p_drop_stroke=0.0,
    p_extra_stroke=0.0,
    stroke_thickness_min=3.5,
    stroke_thickness_max=5.5,
    stroke_thickness_vary=0.5,
    affine_rotate_deg=8.0,
    affine_scale_min=0.90,
    affine_scale_max=1.10,
    affine_shear_deg=5.0,
    affine_translate_frac=0.04,
    elastic_alpha=4.0,
    elastic_sigma=5.0,
    p_dilate=0.0,
    p_erode=0.0,
    p_blur=0.15,
    blur_radius_max=1.0,
    faux_bold_max=0,
)
TRAIN_POLICY = TrainPolicy()
EXPORT_POLICY = ExportPolicy()
