# Photo-mode print findings — why bold sans fails in camera OCR

Measured 2026-06-12 with the new `print` / `print-bold` eval conditions
(`eval.py::_conditions`) and the validator's PRINT rows + per-face table
(`validate_recognizer.py`), against the deployed
`public/data/kanji-recognizer.onnx`.

## The hypothesis that did NOT survive

The starting suspicion was letterform under-representation: training is 80%
KanjiVG strokes / 20% fonts, the bundled pack has no standard bold square
gothic, and no ship gate ever rendered a font. All true — but the deployed
model reads **clean 96px bold-sans renders at ~98–99% top-1** (Hiragino Kaku
Gothic W6–W9, Zen Maru Gothic Bold), with the camera text-presence gate
passing 100%. Letterform coverage is not the bottleneck. Two real per-face
gaps exist but are secondary: SawarabiMincho-Regular (52%) and the
ultra-display Dela Gothic One (76%).

## What actually kills bold sans in photos

Degrading the same bold-face renders the way a camera cell is degraded
(downscale-then-upscale = small source glyphs; intensity scaling = the soft
foreground map) collapses accuracy — and bold sans collapses *first*:

| face set    | clean | 40px | 32px | 26px | ink ×0.6 |
|-------------|------:|-----:|-----:|-----:|---------:|
| bold sans   | 98.3% | 95.8% | 45.8% | 0.8% | 15.8% |
| mincho      | 100%  | 100%  | 85.8% | 15.0% | 70.8% |
| reg. gothic | 100%  | 100%  | 99.1% | 18.8% | 63.2% |

(60 kanji × 2 samples per cell; "Npx" = bilinear resize to N then back to 96,
mimicking `normalizeCell`'s upscale of a small crop; "ink ×0.6" = the whole
map scaled, mimicking a low-contrast soft ink map.)

Two distinct mechanisms:

1. **Source resolution.** Below ~40px of glyph height, bilinear resampling
   merges thick strokes and fills counters. Bold sans loses its inner
   whitespace long before thin-stroked faces do (46% vs 99% at 32px). Manga
   dialogue photographed at arm's length easily lands in the 24–40px band —
   and `imagePreprocess.ts` caps the crop's long side at 1080px
   (`MAX_CROP_DIM`) *before* cells are cut, throwing away resolution the
   sensor actually captured.

2. **Ink amplitude.** Training ink cores are always ≈1.0; the only dimming
   the model ever saw is blur — which dims *thin* strokes but never a filled
   bold region. The camera foreground maps (`fgOtsu` ramp, `bgdist`
   normalized by max distance) emit sub-unity cores whenever contrast is
   imperfect, and `normalizeCell` never re-normalizes intensity. A sharp
   glyph at ink 0.6 drops to 15.8% (bold) / ~65–70% (thin) — dim-thin is
   in-distribution via the blur spectrum, dim-bold is not.

In both failure modes the top-12-mass gate still passes 100%, so photo mode
shows **confident wrong kanji**, not dropped characters — "fails miserably".

## Fix levers, in measured-impact order

1. **SHIPPED — intensity re-normalization in the camera path** (runtime, no
   retrain): each cell is rescaled in `normalizeCell` so the p95 of its
   component ink maps to 1.0 (`coreGain`, naturally capped at `1/INK_THRESH`;
   full-contrast input passes through bit-identically). Verified against the
   probe: bold faces at ink ×0.6 and ×0.4 recover 15.8% → 98.3% top-1 — the
   clean baseline, exactly.
2. **SHIPPED — cut cells from the full-resolution crop** (runtime, no
   retrain): the 1080px `MAX_CROP_DIM` downscale now serves segmentation
   only; when it fires, each cell is re-cut from the original pixels
   (`nativeCell`): per-cell foreground extraction on a small margined crop,
   gated by the cleaned coarse map (`gateByCoarse`) so the global cleanup
   decisions (rules, specks, furigana) still hold, with the
   segmentation-scale cell as fallback. Removes the resampling collapse
   wherever the sensor had the pixels (per the table: 98% at ≥40px vs 46%/0%
   at 32/26px).
3. **CODE LANDED, RETRAIN PENDING — amplitude + resolution invariance**:
   `random_ink_gain` (×uniform(0.5, 1.0) on every sample — amplitude is
   uninformative, mirroring the sharpness-jitter fix), `random_lowres`
   (downscale-upscale, p=0.25, 28–64px — the exact `normalizeCell` transform
   of a small native glyph), and ink grain enabled (within-glyph gradients a
   single per-cell runtime gain can't correct). All three are dampened for
   kana (`kana_render_policy`: low-res erases dakuten) and explicitly OFF in
   `VAL_POLICY` — best.pt selection stays stylus-first. The `print-photo`
   eval condition (print-bold + all three forced on) is the gate row
   (`PRINT-PH` in the validator): the pre-knob model scores low there by
   construction; a retrain must raise it without regressing `deployment` /
   `print`. The same pass fixed a silent label-noise bug: the dataset's font
   path trained blank images against kanji labels when a partial-coverage
   face lacked the glyph (now: re-pick the face, then fall back to strokes).
   **These knobs do nothing for the shipped model until the runbook retrain
   is run.** Pre-retrain `PRINT-PH` baseline (2026-06-12): deployed model
   **29.7%** top-1 / gate 100% (confidently wrong, not dropped — matching the
   in-app "miss" reports). The OLD artifact-heavy model scores 41.3% on the
   same row despite being ~33 pts worse on every clean condition — direct
   evidence the degraded-print axis is trainable without inherent conflict.
4. **Letterform tail**: ultra-display faces (Dela 76%) and SawarabiMincho
   (52%) — pack expansion / stratified font sampling helps here, but it is a
   tail, not the manga failure.

## Pipeline fixes that landed with the measurement

- `print` / `print-bold` eval conditions + per-face attribution table; the
  README ship gate now includes "no `print` regression".
- Validator PRINT rows report the camera gate pass-rate (top-12 mass ≥ 0.02,
  synced with `glyphConfidence.ts`).
- Font discovery: the diversity probe's 0.08 threshold silently rejected
  Dela Gothic One (0.065) — ultra-bold faces never trained; now 0.05.
  macOS Korean/Chinese system faces (AppleSDGothicNeo, STHeiti, Songti,
  Hiragino Sans GB, …) are excluded like their Windows counterparts.
  Stem matching is NFC-normalized (macOS filenames are NFD).
