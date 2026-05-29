# Recognizer retrain runbook

Step-by-step to retrain + ship the kanji recognizer with the synthetic-data fix
from `RECOGNIZER_CHALLENGES.md`, and the **tests to run after training** before
shipping. Run from the repo root.

> **Why:** the fix (sharpness invariance, probabilistic warp, freehand realism,
> identity preservation, calibration, honest val) lives in the training
> pipeline but **does not affect the shipped model until you retrain + export**.
> The currently-deployed `public/data/kanji-recognizer.onnx` is still the old
> one. This runbook produces and validates the new one.
>
> Full context + the measured diagnosis is in `RECOGNIZER_CHALLENGES.md`.

---

## 0. Prerequisites (one-time on a fresh machine)

`.handwriting-work/` is git-ignored, so KanjiVG strokes and the font pack are
**not** in the clone and must be fetched. `data/JMdict_e.gz` and re-running
`classes` are **not** needed — the committed `public/data/kanji-classes.json`
defines the class set, and keeping it as-is is what keeps the model's output
indices aligned with the app.

```bash
python -m venv venv && source venv/bin/activate      # Windows: .\venv\Scripts\Activate.ps1
pip install -r tools/handwriting_ocr/requirements.txt

python -m tools.handwriting_ocr fetch-kanjivg        # ~25 MB, once
python -m tools.handwriting_ocr fetch-fonts          # ~50 MB OFL pack, once (style diversity)
python -m tools.handwriting_ocr fonts --list         # sanity: should list JP font faces
```

Do **not** run `python -m tools.handwriting_ocr classes` unless `JMdict_e.gz`
changed — it would risk reordering class indices and desync the deployed app.

---

## 1. Back up the current model as the comparison baseline

`export` overwrites `public/data/kanji-recognizer.onnx` in place. Stash the
pre-retrain model first so step 4 can measure the delta (no old `.pt` is needed
— the validator compares ONNX to ONNX):

```bash
mkdir -p .handwriting-work
cp public/data/kanji-recognizer.onnx .handwriting-work/kanji-recognizer.baseline.onnx
# Windows: Copy-Item public/data/kanji-recognizer.onnx .handwriting-work/kanji-recognizer.baseline.onnx
```

(If you skip this, the baseline is also recoverable from git:
`git show HEAD:public/data/kanji-recognizer.onnx > .handwriting-work/kanji-recognizer.baseline.onnx`,
**before** you commit the new model.)

---

## 2. Train

Device is auto-selected **CUDA → Apple MPS → CPU**; override with `--device`.

```bash
# Optional fast sanity run first (~minutes): confirms the pipeline + device.
python -m tools.handwriting_ocr train --limit-classes 200 --epochs 5 \
    --samples-per-class 24 --num-workers 4 --no-resume

# The real run (long — hours on GPU/MPS, ~a day+ on CPU). Resumable.
python -m tools.handwriting_ocr train --epochs 30 --patience 8 --val-every 2 --num-workers 6
```

Notes:
- Synthesis (KanjiVG raster + augment) is CPU-bound; `--num-workers N` overlaps
  it with model compute. If the box thrashes (CPU oversubscription), lower N.
- The log prints `device=…`; confirm it's `mps`/`cuda` as expected.
- `best.pt` is selected on the **honest** `VAL_POLICY` now, so its val top-1
  will read **lower** than the old model's did on the old easy proxy — that is
  expected, not a regression (the proxy got harder/more realistic).

---

## 3. Export (folds temperature, int8-quantizes)

```bash
python -m tools.handwriting_ocr export
```

Watch for the `temperature T=… folded` line — that's the calibration. A
`skipping fold` line means the fit was degenerate (only happens on an
undertrained model); investigate before shipping if you see it on the full run.

---

## 4. Tests after training — the gate

Run **all** of these. Do not ship unless 4a/4b show improvement and 4c passes.

### 4a. Automated ONNX comparison (candidate vs baseline)
```bash
python -m tools.handwriting_ocr validate \
    --baseline .handwriting-work/kanji-recognizer.baseline.onnx \
    --candidate public/data/kanji-recognizer.onnx
```
**Expected / pass criteria:**
- `BOX [clean]` and `HOOK [clean]` **confidence goes UP** vs baseline — this is
  the OOD case (sharp + rigid) the old model collapsed on. This is the headline
  signal the fix worked.
- `BOX [freehand]` / `HOOK [freehand]` confidence holds or improves.
- `random [freehand]` / `random [clean]` **top-1 does NOT regress** (≈ baseline
  or better). A few points of confidence movement is fine; a top-1 drop is not.
- If the `freehand` cluster numbers got *worse*, the freehand-realism knobs
  (`endpoint_overshoot_px`, `p_connect_strokes` in `config.py`) are too
  aggressive — dial them down and re-train.

### 4b. (optional) PyTorch head-to-head, if you still have the old checkpoint
Only works if a pre-retrain `best.pt` exists (it is **not** in the repo). If you
have it, copy it to `.handwriting-work/checkpoints/deployed_baseline.pt` and:
```bash
python -m tools.handwriting_ocr eval --condition all
```
Look at the per-condition `cluster[box]` / `cluster[hook]` lines and the
`freehand` condition — candidate should win there.

### 4c. Real handwriting in the app — the real gate
```bash
node scripts/fingerprint-recognizer.mjs   # bump the cache-buster so the browser reloads the new model
npm run dev                               # open the app → Draw mode
```
Draw, by hand, each of: 日 口 目 曰 田 円 己 已 巳 戸, plus a few common kanji
(本 学 生 中 国). Confirm:
- top-1 is correct and its **confidence is meaningfully higher than before**
  (the old model scored ~0.04–0.20 on a clean hand-drawn 日);
- the box/hook clusters rank the right character at or near the top;
- multi-character words still split + resolve (segmenter is unchanged).

Capture a few numbers here for the analysis writeup.

---

## 5. Ship (only if step 4 passed)

```bash
node scripts/fingerprint-recognizer.mjs              # if not already run in 4c
git add public/data/kanji-recognizer.onnx public/data/recognizer-manifest.json
git commit -m "Retrain handwriting recognizer (sharpness/rigidity/freehand fix)"
```

Then update `RECOGNIZER_CHALLENGES.md`: fill the "Validation" section with the
real before/after numbers from steps 4a and 4c.

---

## 6. Follow-up: revisit `minTopScore`

With temperature folded, the recognizer's softmax is calibrated, so the
stopgap floor in `app/lib/analyzer.ts` (`minTopScore = 0.01`) can likely return
to a meaningful value. Pick it from the 4a/4c confidence distribution (e.g. a
correctly-recognized character should now sit well above the floor) and verify
word combinations still surface.

---

## Rollback

The old model is `.handwriting-work/kanji-recognizer.baseline.onnx` (step 1) or
`git show <pre-retrain-commit>:public/data/kanji-recognizer.onnx`. Restore it,
re-run `node scripts/fingerprint-recognizer.mjs`, and commit.

---

## Continuing the analysis in a fresh session

- `RECOGNIZER_CHALLENGES.md` — the measured diagnosis (deployed-model axis
  experiment, the sharp+rigid empty-quadrant finding) and the subset A/B caveat.
- `python -m tools.handwriting_ocr validate --candidate <model.onnx>` (omit
  `--baseline`) — absolute clean/freehand/cluster report for any single model;
  the reusable probe entry point.
- Highest-leverage open lever (not yet built): **stroke-order channels** — see
  the "Remaining work" section of `RECOGNIZER_CHALLENGES.md`.
- The scratch probe scripts from the original analysis lived in
  `.handwriting-work/probe/` (git-ignored — they won't be in a fresh clone), but
  their findings are recorded in `RECOGNIZER_CHALLENGES.md` and the core
  comparisons are reproducible via `validate`.
```
