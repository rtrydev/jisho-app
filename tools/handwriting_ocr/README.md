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
3. **Train** — MobileNetV3-Small on 64×64 grayscale, synthesized on-the-fly:
   font rasterization (~50%) + KanjiVG vector perturbation (~50%) + image
   augmentation on top of both.
4. **Export** — ONNX with int8 quantization, ~3–5 MB.

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

# Step 3: train (hours on a GPU, days on CPU)
python -m tools.handwriting_ocr train --epochs 30 --batch-size 256

# Step 4: export to ONNX + int8 quantize (seconds)
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
| `.handwriting-work/checkpoints/*.pt` | train | PyTorch checkpoints, best by top-5 val accuracy. |
| `public/data/kanji-recognizer.onnx` | export | The shipped model, int8-quantized. |

## Prerequisites

- **JMdict source** at `data/JMdict_e.gz` (already required by
  `tools/data_pipeline`).
- **Japanese fonts** installed on the host. The font rasterizer auto-discovers
  any available TTF/OTF with the `JP` script tag, but a minimum set is
  recommended for variety:
  - **System defaults** (Windows): Yu Gothic, Yu Mincho, Meiryo, MS Gothic, MS Mincho
  - **From Google Fonts** (download and install manually): Noto Sans JP, Noto
    Serif JP, Klee One, Yomogi, Hachi Maru Pop, Yusei Magic, Sawarabi Mincho,
    Reggae One, Hina Mincho, BIZ UDPGothic
  - Run `python -m tools.handwriting_ocr fonts --list` to verify which
    Japanese fonts the rasterizer can see.
- **GPU strongly recommended** for training. CPU training is supported but
  slow (figure 1–2 weeks for a full 30-epoch run vs. 1–2 days on a 3060-class
  GPU).

## Knobs

All hyperparameters live in `config.py`:

- Class-set ceiling (JIS X 0208 L1+L2 or all-of-JMdict)
- Synthesis mix (font ↔ KanjiVG ratio)
- Augmentation strengths (elastic σ/α, affine ranges, stroke-drop probability)
- Training (batch, LR, epochs, schedule, label smoothing)
- Export quantization mode (dynamic, static, fp16)

Bump these in the file; subcommands do not take per-knob overrides on the CLI
(beyond `--epochs` and `--batch-size`) — every other knob being in config keeps
runs reproducible and diffable.

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
