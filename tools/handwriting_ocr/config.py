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
    inputs that can't occur, at the cost of clean-stroke accuracy.

    What we lean on instead (the synthetic→real gap, see RECOGNIZER_CHALLENGES):

    1. **Geometric variety** — many ways of skewing the same skeleton
       (per-stroke wobble + anisotropic affine + moderated elastic).
    2. **Freehand realism** — *how a hand lays ink down*, not just where the
       skeleton sits: endpoint overshoot/undershoot (open/crossing corners),
       semi-cursive stroke connections. This is the part pure geometric skew
       misses and the dominant reason real freehand is out-of-distribution.
    3. **Sharpness invariance** — randomise edge softness across the FULL
       spectrum so the model cannot key on it. The deployed model did exactly
       that (a crisp 日 scored 0.17, blurred 0.84), which is why crisp/real
       input collapsed.
    4. **Identity preservation** — augmentations that turn a character into a
       *different in-vocabulary character* (whole-stroke drop/add) are OFF; a
       wrong label is worse than less variety, especially on the box/hook
       homoglyph clusters.

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
    # Dropping / adding a whole stroke is OFF by default: within the JIS L1+L2
    # class set a dropped stroke routinely turns a character into a DIFFERENT
    # class that is also present (目→日, 田→囲-ish, 王→玉…), so the label
    # becomes wrong and the model is taught the box/hook cluster is
    # interchangeable — exactly the confusion measured in RECOGNIZER_CHALLENGES.
    # Real "missing/extra ink" robustness is modelled by endpoint + connection
    # realism below, which perturbs appearance without changing identity.
    p_drop_stroke: float = 0.0            # was 0.04 — see note above
    p_extra_stroke: float = 0.0           # was 0.02 — see note above

    # --- Freehand stroke realism (KanjiVG path; viewport units, ~109) --- #
    # The geometric skew above varies the *skeleton*; these model how a hand
    # actually lays ink down, which is the bulk of the synthetic→real gap that
    # pure affine/elastic skew misses:
    #   * endpoint overshoot/undershoot — corners that don't close or that
    #     cross (the 口/日/目 box is rarely sealed in freehand). Each stroke
    #     end is extended along its own tangent by uniform(-x, x).
    #   * stroke connection — a faint pen-drag from one stroke's end to the
    #     next stroke's start, as in fast/semi-cursive writing.
    endpoint_overshoot_px: float = 4.0
    p_connect_strokes: float = 0.15       # per adjacent-stroke gap
    connect_max_px: float = 7.0           # viewport units

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
    # `p_affine` < 1 leaves a fraction of samples at canonical position (see
    # the rigidity note on p_elastic below).
    p_affine: float = 0.9
    affine_rotate_deg: float = 13.0
    affine_scale_min: float = 0.80
    affine_scale_max: float = 1.20
    affine_shear_deg: float = 9.0
    affine_translate_frac: float = 0.06

    # --- Elastic warp (image-space px; nonlinear sloppiness) ------------ #
    # Lowered 6.0 → 4.0: α=6 over-warps the compact box/hook glyphs into one
    # another (a strong nonlinear field can bend 日's middle bar until it
    # reads as 目/曰). 4.0 keeps natural sloppiness without melting identity.
    #
    # `p_elastic` < 1 is the OTHER half of the synthetic→real fix: the deployed
    # model warped EVERY sample (elastic always on + affine always on), so a
    # cleanly-drawn rigid glyph — the "sharp AND unwarped" quadrant that
    # careful real handwriting lands in — was never seen and collapsed
    # (canonical 日 ≈ 0.32 vs warped ≈ 0.50–0.88). Leaving a share of samples
    # un-warped (and un-affined) populates that quadrant so rigid input is
    # in-distribution.
    p_elastic: float = 0.6
    elastic_alpha: float = 4.0
    elastic_sigma: float = 5.0

    # --- Morphology: mild stroke thicken/thin wobble -------------------- #
    p_dilate: float = 0.15
    p_erode: float = 0.10

    # --- Edge sharpness invariance -------------------------------------- #
    # THE measured root cause of low real-world confidence: the deployed model
    # keys on the synthetic *edge softness* itself. A razor-sharp canonical 日
    # scores 0.17 but the same glyph blurred r=1.5 scores 0.84 — i.e. clean /
    # crisp / real-handwriting input is out-of-distribution. p_blur=0.25 left
    # 75% of training crisp at one fixed sharpness, so sharpness became
    # informative. `sharpness_jitter_max` > 0 instead blurs EVERY sample by
    # uniform(0, max) — the full spectrum from razor-sharp (0) to soft — so the
    # model cannot use sharpness as a feature and crisp input stops being OOD.
    # When 0, falls back to the legacy p_blur/blur_radius_max path.
    sharpness_jitter_max: float = 1.5
    p_blur: float = 0.25                  # legacy path (used when jitter == 0)
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
    # Lowered 0.1 → 0.05: over 5,454 classes, ε=0.1 holds out a tenth of the
    # mass for the "not this class" tail and caps the achievable top-1 softmax,
    # compounding the low-confidence problem. 0.05 keeps the regularisation
    # benefit with a higher confidence ceiling. Calibration is finished at
    # export time by temperature scaling (see export.fit_temperature).
    label_smoothing: float = 0.05
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
    # fp32 ("none") is the shipped format. Measured on a Ryzen 5 3600 via the
    # CPU EP (single-thread, matching prod — the site sets COOP but not COEP so
    # `crossOriginIsolated` is false and ORT runs `numThreads=1`):
    #   int8 dynamic  241 ms  (2.9 MB)   <- was shipped; caused Draw-mode lag
    #   fp16           17 ms  (5.9 MB)
    #   fp32           14 ms  (11.3 MB)  <- shipped: fastest + simplest
    # Dynamic int8 emits ConvInteger/DynamicQuantizeLinear, and ORT's CPU/WASM
    # backend has no fast ConvInteger kernel — a ~17x trap for this Conv-bound
    # CNN (int8 dynamic only pays off for MatMul-bound transformers). fp32 keeps
    # plain Conv kernels (fastest) with no fp16 dtype risk in WASM; the larger
    # download is a one-time, immutably-cached cost. (Switch to "fp16" if the
    # download size ever matters more than the last ~3ms / dtype simplicity.)
    quantization: str = "none"  # one of: "dynamic", "fp16", "none"

    # Temperature scaling (Guo et al. 2017): fit a single scalar T on the
    # deployment-proxy distribution and fold 1/T into the final linear layer
    # before export, so the shipped logits are calibrated and the downstream
    # `minTopScore` floor stops being guesswork. Makes scores comparable
    # across characters; it does NOT change argmax/ranking. Fit on a capped
    # class subset (a scalar needs little data) to keep export fast.
    calibrate_temperature: bool = True
    calib_max_classes: int = 800
    calib_samples_per_class: int = 3


CLASS_POLICY = ClassPolicy()
SEGMENT_POLICY = SegmentPolicy()
# Training distribution (heavier, for generalization).
SYNTH_POLICY = SynthesisPolicy()
# Validation distribution = the DEPLOYMENT proxy. This is what selects
# best.pt, so the chosen checkpoint is the one that does best on what the app
# actually feeds the model: clean stroke line-art (KanjiVG only, no print
# artifacts) with moderate, realistic geometric sloppiness. The stroke-width
# midpoint (3.5–5.5 → 4.5) matches preprocess.ts STROKE_WIDTH at 96px.
#
# HONESTY FIX (see RECOGNIZER_CHALLENGES.md): the previous proxy fixed
# sharpness (p_blur=0.15 only) and had no freehand realism, so it scored a
# model 0.77 on a 日 it scored 0.04 on in the real app — it rewarded the very
# augmentation-signature overfit that hurts real input. The proxy now spans
# the full sharpness spectrum (`sharpness_jitter_max`, incl. razor-sharp) and
# carries the same endpoint/connection freehand realism as training, so a
# model that only works on soft/blurred input is correctly penalised here.
VAL_POLICY = SynthesisPolicy(
    p_kanjivg=1.0,
    stroke_jitter_px=1.5,
    stroke_local_shift_px=1.5,
    stroke_local_rotate_deg=2.0,
    p_drop_stroke=0.0,
    p_extra_stroke=0.0,
    endpoint_overshoot_px=3.0,
    p_connect_strokes=0.12,
    connect_max_px=6.0,
    stroke_thickness_min=3.5,
    stroke_thickness_max=5.5,
    stroke_thickness_vary=0.5,
    # Substantial rigid + canonical-position coverage: careful real handwriting
    # is often drawn cleanly, so the proxy must include the un-warped case.
    p_affine=0.85,
    affine_rotate_deg=8.0,
    affine_scale_min=0.90,
    affine_scale_max=1.10,
    affine_shear_deg=5.0,
    affine_translate_frac=0.04,
    p_elastic=0.5,
    elastic_alpha=4.0,
    elastic_sigma=5.0,
    p_dilate=0.0,
    p_erode=0.0,
    sharpness_jitter_max=1.5,
    faux_bold_max=0,
)
TRAIN_POLICY = TrainPolicy()
EXPORT_POLICY = ExportPolicy()
