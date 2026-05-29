# `tools/handwriting_ocr/` — synthetic-data CNN for kanji handwriting

Trains a small image classifier that recognizes hand-drawn kanji and ships it
to the browser as ONNX. The model is trained **entirely on synthetic data**
generated from KanjiVG vector strokes and Japanese fonts; no real handwriting
corpus is required to ship the MVP.

See the design rationale in the conversation history under "How would one
approach creating the CNN…" — this README only documents the runnable
pipeline.

## Pipeline at a glance

```
JMdict_e.gz  →  classes  ─┐
                          ├─→  synthetic dataset  →  train  →  ONNX  →  public/data/
KanjiVG SVGs  ────────────┘                  ↑
Japanese fonts  ─────────────────────────────┘
```

1. **Extract the class set** from JMdict — kanji codepoints actually used in
   dictionary headwords, intersected with JIS X 0208 L1+L2 for a stable
   Unicode-defined ceiling.
2. **Fetch KanjiVG** — per-stroke SVG paths for ~10k kanji (one-time).
3. **Train** — `simple_resnet` on 96×96 grayscale, synthesized on-the-fly.
   Stroke-dominant (KanjiVG vector perturbation ~80% + a minority of fonts for
   letterform-style variety), rendered as clean ink line-art — matching what
   the app's stylus/mouse canvas actually feeds the model — with rich geometric
   skew (per-stroke wobble, anisotropic affine, elastic) on top. Validation
   uses a *separate* **deployment-proxy** distribution (`VAL_POLICY`) so
   `best.pt` is chosen on real-input-like samples, not on the heavier training
   mix.
4. **Evaluate** — head-to-head vs. the deployed model on the deployment proxy
   (`eval`); only ship if the candidate wins.
5. **Export** — ONNX with int8 quantization, ~3 MB.

## Run it

```powershell
# One-time setup
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r tools/handwriting_ocr/requirements.txt

# Step 1: extract class set (seconds; needs data/JMdict_e.gz)
python -m tools.handwriting_ocr classes

# Step 2: fetch KanjiVG (one-time, ~25 MB download)
python -m tools.handwriting_ocr fetch-kanjivg

# Step 3: fetch the curated OFL font pack (one-time, ~50 MB download)
python -m tools.handwriting_ocr fetch-fonts

# Step 4: train (hours on a GPU, days on CPU). Default arch is simple_resnet.
python -m tools.handwriting_ocr train --epochs 30 --batch-size 256 --patience 8 --val-every 2

# Step 5: evaluate the new checkpoint vs. the deployed baseline on the
#         deployment-proxy distribution — ship only if it wins
python -m tools.handwriting_ocr eval

# Step 6: export to ONNX + int8 quantize (seconds)
python -m tools.handwriting_ocr export
```

Each subcommand is independent and idempotent — re-running step 1 after a
JMdict update only changes `kanji-classes.json`; you need to retrain after to
match the new class indices.

## Outputs

| File | Stage | What it is |
|---|---|---|
| `public/data/kanji-classes.json` | classes | Ordered list of kanji codepoints. **Index = class index** in the model's softmax output — the runtime maps argmax → kanji via this file. |
| `.handwriting-work/kanjivg/kanji/*.svg` | fetch-kanjivg | Per-character SVG stroke paths. Working artifact, not shipped. |
| `.handwriting-work/checkpoints/*.pt` | train | PyTorch checkpoints, best by top-5 on the deployment-proxy validation distribution (`VAL_POLICY`). Self-describing: each stores its `arch` + `image_size`. |
| `public/data/kanji-recognizer.onnx` | export | The shipped model, int8-quantized. |

## Prerequisites

- **JMdict source** at `data/JMdict_e.gz` (already required by
  `tools/data_pipeline`).
- **Japanese fonts**. The font rasterizer auto-discovers TTF/OTF/TTC files
  from two sources:
  - **Bundled OFL pack** in `.handwriting-work/fonts/` — downloaded by
    `python -m tools.handwriting_ocr fetch-fonts`. Covers kyokasho-tai
    (Klee), kaisho-brush (Yuji Syuku/Boku/Mai), mincho (Shippori, Zen Old,
    Hina, Sawarabi), gothic (Sawarabi, Kosugi, Zen Maru, Dela), and
    handwriting display (Zen Kurenaido, Hachi Maru Pop, Yusei Magic,
    RocknRoll One, Reggae One). This is the source of style diversity —
    don't skip it.
  - **System fonts** discovered from the platform font directories.
    Picked up automatically; useful on Windows for the Yu Mincho /
    Yu Gothic / MS Mincho TTC sub-faces that ship with the OS.
  - Run `python -m tools.handwriting_ocr fonts --list` to verify what the
    rasterizer can see. TTC sub-faces appear with `#N` after the flag.
- **GPU strongly recommended** for training. CPU training is supported but
  slow (figure 1–2 weeks for a full 30-epoch run vs. 1–2 days on a 3060-class
  GPU).

## Knobs

All hyperparameters live in `config.py`:

- Input resolution (`SynthesisPolicy.image_size`, 96 — **must** equal
  `app/lib/handwriting/preprocess.ts` `IMAGE_SIZE`, and its stroke-thickness
  midpoint must track that file's `STROKE_WIDTH`)
- Class-set ceiling (JIS X 0208 L1+L2 or all-of-JMdict)
- **Two synthesis distributions:** `SYNTH_POLICY` (training — stroke-dominant,
  rich geometric skew, print/sensor artifacts off because a stylus canvas never
  produces them) and `VAL_POLICY` (validation = deployment proxy: clean strokes
  + moderate skew). They deliberately differ — see the class docstring in
  `config.py`.
- Geometric skew (per-stroke shift/rotate, anisotropic affine, elastic σ/α,
  stroke-thickness range, drop/extra-stroke probabilities)
- Training (batch, LR, epochs, schedule, label smoothing, `val_every_n_epochs`)
- Export quantization mode (dynamic, static, fp16)

Bump these in the file; subcommands take a few CLI overrides for the knobs you
legitimately tweak between runs:

| Flag | Overrides |
|---|---|
| `--arch NAME` | model architecture: `simple_resnet` (default), `mobilenet_v3_small`, `mobilenet_v3_small_s1` |
| `--epochs N` | `TrainPolicy.epochs` |
| `--batch-size N` | `TrainPolicy.batch_size` |
| `--val-every N` | `TrainPolicy.val_every_n_epochs` (epoch 0 + last are always validated) |
| `--patience N` | early-stopping patience in epochs since best val top-5 |
| `--limit-classes N` / `--samples-per-class N` | smoke-test knobs |

Every other knob stays in config so runs are reproducible and diffable.

## Evaluation — don't ship a regression

`eval` scores a candidate checkpoint against a baseline on **identical, seeded**
samples, under named conditions. The default `deployment` condition is
`VAL_POLICY` — clean stylus strokes — i.e. what `preprocess.ts` feeds the model.

```powershell
# Candidate = checkpoints/<arch>/best.pt; baseline = checkpoints/deployed_baseline.pt
python -m tools.handwriting_ocr eval                       # deployment proxy (the gate)
python -m tools.handwriting_ocr eval --condition all       # + clean ceiling + training dist
python -m tools.handwriting_ocr eval --baseline path/to/old.pt --condition deployment
```

Each model is scored at its **own** input resolution on the same seeded
sample (same character + same geometric skew), so a 96px candidate is directly
comparable to a 64px baseline. The output reports top-1/top-5 for both plus a
per-sample agreement tally.

> **Why this exists:** a prior run shipped-by-mistake-criteria — it was selected
> on a font/ink/cutout-heavy val set the canvas never produces, and lost badly
> on real clean strokes. Run `eval` before every `export`; only ship a model
> that beats the deployed one on the `deployment` condition. To set the
> baseline, copy the currently-deployed checkpoint to
> `.handwriting-work/checkpoints/deployed_baseline.pt` before retraining.

## Training logs

`train` writes a timestamped log to `.handwriting-work/checkpoints/<arch>/training.log`
— so `simple_resnet` (the default) logs under `checkpoints/simple_resnet/`. The
`mobilenet_v3_small` arch is the historical exception and uses the
`checkpoints/` root. The file appends across runs, so it survives terminal
crashes and gives you a single place to diff hyperparameter changes against
accuracy. The console shows the same lines plus a per-batch `tqdm` progress bar
with running loss, top-1, top-5, and ETA.

## Licensing

The training pipeline consumes JMdict (EDRDG, CC BY-SA 4.0) and KanjiVG
(Ulrich Apel, CC BY-SA 3.0). Both are share-alike, both require attribution.
The trained model is a derivative — when shipping the ONNX file, attribute
both sources in `public/data/ATTRIBUTION.md` and link the model under the same
share-alike terms.

Japanese fonts have their own per-font licenses (most Google Fonts JP files
are OFL or Apache 2.0). No font glyphs are embedded in the output model; the
fonts are only used to generate training images, which is generally permitted
under the OFL "no embedding" clause. Check per-font licenses before
redistributing the training scripts with bundled fonts.
