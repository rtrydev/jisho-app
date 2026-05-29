# Kanji recognizer — known challenges & the synthetic-data fix

Analysis of **recognition quality** (the single-character model), separate from
segmentation. Segmentation (`segment_*.py` + `app/lib/handwriting/segmentStrip.ts`)
is a solved, separate model; this doc is about the *recognizer*
(`kanji-recognizer.onnx`).

The first half (originally written while building the boundary segmenter, May
2026) records the *symptoms*. The **"May 2026 root-cause analysis"** section
below reproduces them with measurements, pins the cause, and documents the
synthetic-data fix that was implemented in the training pipeline.

## What the recognizer is

- **Arch:** compact `simple_resnet` (`model.py`) — 1×96×96 grayscale → 5454-way
  softmax. The 5454-class head dominates the parameter count. Int8-quantized to
  ~2.9 MB so it runs client-side in `onnxruntime-web` (WASM).
- **Training:** 100% synthetic, no real-handwriting corpus. Stroke-dominant
  (KanjiVG vector strokes ~80% + fonts ~20%) with heavy *geometric*
  augmentation (per-stroke wobble, affine, elastic); print/sensor artifacts
  deliberately off. Validation/selection uses `VAL_POLICY` as a deployment
  proxy. See `config.py`.
- **Inference input:** strokes → `app/lib/handwriting/preprocess.ts`
  (`strokesToInput`) → bbox-fit into 96×96 with a 0.12 margin, 4.5px stroke,
  ink=1 / bg=0.

## The core problem: low confidence on real input

The model's softmax is **low-magnitude on real handwriting**, even when the
top-1 is correct — which makes top-1 unreliable for visually similar characters
and makes any score threshold fragile.

Originally observed (top-1 softmax, correct class):

| Input | top-1 | notes |
|---|---|---|
| 本 / 学 / 生 / 大 / 中 / 国 (clean, rendered) | 0.81–0.92 | distinctive → strong |
| 日 (clean, rendered) | **~0.19** | competes with 目/曰/田/旦/円 |
| 日 (real handwriting, in app) | **0.04–0.07** | still top-1, but barely |

Consequences seen downstream:
- `findWordCombinations` had a `minTopScore` floor of 0.05 that silently
  suppressed word matches when a correct character scored 0.04; lowered to 0.01
  as a stopgap.
- Candidate-row ordering for box/hook kanji is unstable: the right character is
  present but often not rank 1.

## Confusion clusters

The model conflates visually similar simple kanji:
- **Box family:** 日 目 曰 田 旦 円 口 囗 (and 已/己/巳 leaking in).
- **Hook/コ family:** 己 已 巳 弓 戸.

---

# May 2026 root-cause analysis (synthetic-only)

Everything here was measured against the **deployed** `kanji-recognizer.onnx`
(version `ab75cf1e7983`, simple_resnet@96, 5454 classes) using the existing
synthesis code to render probes. Scripts live in `.handwriting-work/probe/`
(scratch, git-ignored).

## 1. It is NOT a calibration-only problem; the model is overfit to the synthetic *augmentation distribution*

Scoring the deployed model on its own synthetic distributions reveals the model
is **plenty confident on what it was trained/selected on, and only collapses
off it**:

| Distribution (150 random KanjiVG classes) | mean self-conf | top-1 |
|---|---|---|
| `VAL_POLICY` (deployment proxy — moderate skew) | **81.0%** | 100% |
| clean canonical, sharp | 73.7% | 99.3% |
| clean canonical **+ blur r=1.2** | **90.7%** | 100% |

So the "deployment proxy" reports 81% on the very inputs the app scores 0.04 on
— it is **not** a faithful proxy. The collapse concentrates in the box/hook
clusters: a clean canonical 日 scored **0.17–0.32** depending on render, while
the *same glyph blurred r=1.5 scored 0.84*.

## 2. The true OOD axis: the "sharp **and** rigid" quadrant is empty

Adding one perturbation at a time to a perfectly-canonical render and watching
the deployed model's self-confidence pinpoints the cause (mean over 10 renders):

| added to canonical | 日 | 目 | 曰 | 口 | 巳 |
|---|---|---|---|---|---|
| *nothing (canonical, sharp, rigid)* | **32** | 70 | 77 | 73 | 78 |
| + elastic warp | 50 | 85 | 82 | 74 | 83 |
| + affine skew | 50 | 83 | 89 | 76 | 86 |
| + freehand corners | 47 | 72 | 70 | 74 | 64 |
| **+ blur r=1.2** | **69** | **94** | **94** | **92** | **90** |

Two findings:
- **Edge softness (blur) is the single biggest lever** — the model leans on the
  synthetic anti-aliasing softness as if it were class evidence.
- **Any warp also helps** — the model wants *some* perturbation present.

The deployed model warps **every** training sample (elastic α=6 *always* on +
affine *always* on) at essentially one sharpness band (`p_blur=0.25`). So the
quadrant "**sharp AND rigid (un-warped)**" — exactly what carefully-drawn real
handwriting produces — was never in training and collapses. As corroboration,
the deployed model scores **88% on a sharp-but-freehand-and-skewed proxy**
(`REALISH`) — i.e. sharpness alone isn't fatal *when warp is present*; it is the
sharp-**and**-rigid corner that breaks.

## Ruled out (don't re-chase)

- **Not an `onnxruntime-web` backend issue.** ort-web matches Python ORT.
- **Not the segmenter.** Separate model; recognition runs on split groups.
- **Not "faint ink".** Scaling ink down helps only because it is a crude blur;
  the real axis is edge softness + warp coverage, isolated above.
- **The ORT-web multi-session proxy bug is fixed** (`wasm.proxy` off).

---

# The fix (implemented — synthetic-data only)

All changes are in the training pipeline; the **model input contract is
unchanged** (1×96×96 → logits), so the deployed ONNX keeps working and no
TypeScript/inference change is required to adopt them. They close the
synthetic→real gap by making the previously-empty input regions
**in-distribution**, and they make the selection metric honest.

### 1. Sharpness invariance — `SynthesisPolicy.sharpness_jitter_max`
Blur **every** sample by `uniform(0, 1.5)` (the full spectrum from razor-sharp
to soft) instead of the old fixed `p_blur=0.25`. The model can no longer treat
edge-softness as a feature, so crisp real input stops being OOD.
(`augment.random_blur`)

### 2. Probabilistic warp — `p_elastic=0.6`, `p_affine=0.9`
Elastic and affine are now applied *with a probability*, so a meaningful share
of samples stay **rigid / at canonical position**. Combined with (1) this
populates the "sharp + rigid" quadrant. (`augment.random_affine`,
`augment.elastic_deform`)

### 3. Freehand stroke realism — `endpoint_overshoot_px=4.0`, `p_connect_strokes=0.15`
Stroke ends are extended/retracted along their tangent (open/crossing corners —
the box of 口/日/目 is rarely sealed in freehand), and adjacent strokes are
occasionally joined by a light pen-drag (semi-cursive). This is the part pure
geometric skew misses. (`kanjivg._extend_endpoints`, connector rendering)

### 4. Identity preservation — `p_drop_stroke=0`, `p_extra_stroke=0`, elastic α 6→4
Dropping/adding a whole stroke turns a character into a *different
in-vocabulary* character (目→日, …) — a wrong label that taught the box/hook
cluster to be interchangeable. Removed. Elastic strength lowered so it stops
melting compact glyphs into their cluster-mates.

### 5. Calibration — label smoothing 0.1→0.05 + temperature scaling at export
Lower smoothing raises the confidence ceiling over 5,454 classes; export now
fits a scalar temperature on the deployment proxy and **folds 1/T into the final
linear layer** (`export._calibrate`), so shipped logits are calibrated with no
inference-side change. Makes scores comparable so the `minTopScore` floor stops
being guesswork.

### 6. Honest selection + diagnostics
- `VAL_POLICY` now spans the sharpness spectrum + freehand + rigid coverage, so
  `best.pt` is no longer selected for augmentation-signature overfit.
- `eval.py`: the `clean` condition explicitly zeroes the new knobs; added a
  `freehand` (real-handwriting proxy) condition and a **per-cluster
  (box/hook) top-1 + confidence diagnostic** printed every run.

## Validation — subset A/B (OLD vs NEW synthesis)

Full training is intentionally **not** run here. Instead a controlled A/B trains
a fresh `simple_resnet` on an identical class subset (the box/hook clusters +
distinct + filler), identical seed/epochs, differing **only** in the synthesis
policy, then scores held-out conditions. (`.handwriting-work/probe/ab_synth.py`)

Result (46 classes = 26 cluster/distinct + 20 filler, 64px, 22 epochs, single
seed; OLD = pre-fix always-warp synthesis, NEW = all fixes). top-1 / mean
self-confidence on the held-out conditions:

| cond | arm | all | BOX | HOOK | DIST |
|---|---|---|---|---|---|
| CANON (sharp+rigid) | OLD | 96.6 / 91.0 | 84.8 / 76.9 | 100 / 91.3 | 97.3 / 91.9 |
| CANON (sharp+rigid) | NEW | 96.7 / 88.2 | 82.1 / 72.9 | 98.6 / 86.1 | 100 / 89.5 |
| REALISH (real proxy) | OLD | 99.8 / 94.2 | 100 / 91.4 | 98.6 / 84.8 | 100 / 96.3 |
| REALISH (real proxy) | NEW | 99.1 / 93.1 | 99.1 / 90.5 | 92.9 / 84.1 | 100 / 94.6 |
| AUGSIG (blurred) | OLD | 99.2 / 94.3 | 98.2 / 88.1 | 95.7 / 85.4 | 100 / 97.2 |
| AUGSIG (blurred) | NEW | 99.5 / 94.5 | 99.1 / 90.3 | 97.1 / 89.6 | 100 / 96.0 |

**Read this honestly — it is a near-null result, by design limitation.** Both
arms hit `train_top1=100%` (memorised the 2,944-image cache) and both score
96–100% top-1 on every condition. The 46-class subset is **far too easy to
reproduce the deployed model's collapse** (deployed canonical 日 ≈ 0.32; here
even OLD scores box-canonical 76.9% conf) — the pathology is **regime-dependent**:
it needs the 5,454-class competition + capacity pressure. So the subset:

- ✅ confirms the new synthesis **trains, converges, and does not regress**
  held-out accuracy (all conditions 96–100% for both arms);
- ✅ shows BOX-canonical is the weakest cell for *both* arms — the cluster
  ordering of difficulty is reproduced, just heavily attenuated;
- ⚠️ shows NEW costs a few points of *peak confidence* on the easy canonical
  case (BOX conf 76.9→72.9). This is the expected price of spreading the model
  over a wider appearance distribution and is **not** evidence against the fix
  — the subset never exercises the hard regime where the benefit (real input
  in-distribution) would appear.
- ❌ **cannot** demonstrate the real-input accuracy gain. That rests on the
  direct deployed-model axis measurements above, and must be confirmed by the
  full retrain.

The pipeline itself was smoke-tested end-to-end through the real entry points
(`train.train` + `export.run`, 120 classes, 2 epochs): training runs with the
new synthesis/`VAL_POLICY`, ONNX export + int8 quantize succeed, and the
temperature-fit guard correctly *skips* folding when the (barely-trained) fit is
degenerate (T=19, outside [0.2, 5.0]).

> **Bottom line:** the fix is well-motivated by direct measurement of the
> deployed artifact and is validated as non-regressing and pipeline-correct, but
> its magnitude is **unproven without a full-scale retrain**. Gate shipping on
> the `eval` cluster/freehand lines beating the current baseline (below). The
> freehand-realism knobs (`endpoint_overshoot_px`, `p_connect_strokes`) are the
> most speculative — `eval`'s box-cluster line is the signal to keep or dial
> them back.

## Remaining work / how to ship

1. **Run the full retrain + export, then validate.** The implemented fix only
   takes effect once the model is retrained — the shipped ONNX is still the old
   one. Follow **`RETRAIN_RUNBOOK.md`** (backup baseline → `train` →
   `export` → `validate` → in-app handwriting check → ship). The runbook is
   self-contained for a fresh machine; the new `validate` subcommand compares
   the candidate ONNX against the stashed baseline ONNX on the clean/freehand
   conditions + box/hook clusters (no old `.pt` required).
2. **Revisit `minTopScore`** in `app/lib/analyzer.ts` once the calibrated model
   ships — with temperature scaling the 0.01 stopgap can likely return to a
   meaningful floor.
3. **Highest-leverage future lever — stroke-order channels (online recognition).**
   Even with appearance fixed, an image-only 96px bitmap cannot fully separate
   日(4 strokes)/口(3)/目(5) when drawn sloppily. KanjiVG carries writing order
   and the app already captures `Stroke[]` order, so a 2-channel input
   (ink + per-stroke writing-order intensity) is synthetic- *and*
   inference-compatible. It needs a new model (channel-count change), matching
   `preprocess.ts` channels, and a manifest-gated load so the 1-channel model
   keeps working — hence deferred to a dedicated change with a full training run.

## Pointers

- Model + training: `tools/handwriting_ocr/` (`model.py`, `config.py`,
  `dataset.py`, `augment.py`, `kanjivg.py`, `train.py`, `eval.py`, `export.py`).
- Inference preprocessing: `app/lib/handwriting/preprocess.ts`, `recognize.ts`.
- Probe/experiment scripts (scratch): `.handwriting-work/probe/`.
