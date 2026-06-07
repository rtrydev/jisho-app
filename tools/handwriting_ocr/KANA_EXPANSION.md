# Adding hiragana + katakana to the OCR engine

Plan + runbook for extending the handwriting/camera OCR engine (the
`simple_resnet` recognizer **and** the boundary segmenter) from kanji-only to
**kanji + kana**. Companion to `RECOGNIZER_CHALLENGES.md` (the recognizer's known
weaknesses) and `RETRAIN_RUNBOOK.md` (the ship flow). Read those first.

> **Status:** all *code* is implemented. The two model artifacts
> (`kanji-recognizer.onnx`, `kanji-segmenter.onnx`) must be **retrained** to take
> effect — that's a multi-hour compute step, run by the maintainer per
> "Execution" below. Until then the shipped models are still kanji-only and the
> shipped `kanji-classes.json` is intentionally **left kanji-only** (it is a
> matched pair with the model — see Phase 1).

---

## Why it's viable (and where the cost actually is)

- **No new data.** KanjiVG already ships full kana stroke coverage — verified 86
  hiragana + 90 katakana SVGs in `.handwriting-work/kanjivg/kanji/`, including
  voiced (が), small (っ/ゃ), ヴ and ー. Fonts render kana trivially. The model
  head auto-resizes to the new class count; latency/size barely move.
- **`findWordCombinations` benefits for free** — okurigana/kana words (使う,
  コーヒー) can finally match, because it already does string lookups against full
  JMdict headwords. The app already routes those to Read (`openInRead`).
- **The cost is not the model — it's the irreducible ambiguities + downstream
  routing.** Three classes of problem have *no pixel-level fix* and are handled by
  policy, not by training harder:

| Problem | Why it can't be solved at the pixel level | Decision |
|---|---|---|
| **Small vs full kana** (っ/つ, ゃ/や) | `strokesToInput`/`normalizeCell` bbox-fit every glyph to fill 96px → **scale is deleted**, and scale is the only difference. | **Fold small → full.** Small kana are simply *not classes*; normalization makes a drawn っ look like つ, so the model reads つ. Recover the small form downstream (dictionary/context). |
| **Cross-script homoglyphs** (ロ/口, カ/力, エ/工, ニ/二, ハ/八, タ/夕, へ/ヘ, ー/一) | Geometrically identical in isolation; several collide with kanji **already in the class set** (口 is the weakest "box cluster" cell). | **Keep both** — they're both real characters. Accept the irreducible confusion; lean on context downstream; track them in the cluster diagnostic. |
| **Dakuten/handakuten** (か/が, は/ば/ぱ) | 2 tiny top-right marks that blur/erode augmentation can erase, and that the segmenter can split off as their own glyph. | Cap blur/erode for kana (Phase 2); oversample voiced kana as single cells in segmenter strips + a conservative dakuten merge-veto (Phase 4). |

The long-term real fix for the homoglyph / stroke-count ceiling is the
**stroke-order channel** lever already flagged in `RECOGNIZER_CHALLENGES.md`
("Remaining work") — out of scope here.

---

## Phase 0 — decisions (locked)

- **Scope of kana classes:** gojūon (clear) + voiced + semi-voiced for both
  syllabaries, plus ゔ/ヴ and the chōonpu ー. **Excluded:** small kana
  (ぁぃぅぇぉっゃゅょゎ / ァィゥェォッャュョヮ — folded), archaic (ゐゑ/ヰヱ/ヷヸヹ),
  iteration/voicing marks (ゝゞ/ヽヾ/゛゜) and the middot ・. Net **≈145 classes**
  → recognizer grows from 5,454 to ~5,599.
- **Small-kana fold:** no code — it's the *absence* of small kana from the class
  list. Documented limitation: a freestanding small kana reads as its full form.
- **Class ordering:** kana are **appended after** the kanji, so toggling
  `include_kana` never moves a kanji index (verified additive). Note the *shipped*
  `kanji-classes.json` has pre-existing order drift vs a fresh `classes` run
  (~2001 kanji reorder — same set, different frequency tie-breaks, because the
  shipped file predates a JMdict/code change; this is why the runbook says "don't
  run `classes`"). A full kana retrain re-runs `classes` and thus adopts the
  current ordering — harmless, since the model and `kanji-classes.json` ship as a
  matched, fingerprinted pair and order is otherwise irrelevant.

---

## Phase 1 — class set (`config.py`, `classes.py`)

- `ClassPolicy.include_kana: bool = True` and the curated kana block constants.
- `extract_classes()` appends the kana block after the kanji sort/cap.
- `run()` bumps the schema to `kanji-classes/v2`, records `include_kana`, and
  prints a kana count.
- `is_kana(ch)` predicate (consumed by synthesis + diagnostics).

> **Coupling rule:** `kanji-classes.json` MUST be regenerated *and shipped
> together with the retrained model* — a kana-inclusive class list against the
> old 5,454-output model corrupts every prediction. So regenerating it is **step
> 1 of the retrain**, not a standalone commit. This session leaves the shipped
> JSON untouched on purpose.

## Phase 2 — kana-aware synthesis + diagnostics

- **Identity-preserving dampening** (`config.kana_render_policy`): for kana,
  scale down elastic / endpoint-overshoot / stroke-connection / affine-rotation
  and cap blur+erode (so loops don't close ぬ→め and dakuten marks survive).
  Applied per-char in `dataset.py` and `segment_synth.py`, so it covers both the
  training and the (deployment-proxy) validation distributions.
- **Cluster diagnostics** (`eval.CONFUSION_CLUSTERS` → also consumed by
  `validate_recognizer.py`): add kana families — cross-script homoglyphs,
  dakuten discrimination, and the loopy hiragana confusables — so the retrain is
  gated on them exactly like the box/hook clusters.

## Phase 3 — recognizer retrain + export

No code beyond Phases 1–2. Follow `RETRAIN_RUNBOOK.md` with the kana clusters as
added gates. The head auto-resizes; temperature is re-fit at export.

## Phase 4 — segmenter (`segment_synth.py`, `segment.ts`)

- `SegmentPolicy.kana_strip_frac`: oversample kana into the synthetic strips
  (uniform sampling from 145/5599 classes would under-represent kana vs real
  mixed-script text), and apply the same kana dampening to strip glyphs.
- `segment.ts`: a conservative **dakuten merge-veto**
  (`filterMarkBoundaries`) — drop a predicted boundary whose right side is only a
  tiny, high-positioned mark cluster (the dakuten/handakuten signature). Like the
  existing stroke-crossing veto it can **only ever merge**, so it can't
  under-segment real text. Single wide kana (へ/く/し/こ) are already protected by
  the existing stroke-crossing veto (their stroke spans the cut). Unit-tested.

## Phase 5 — downstream routing (the compatibility payoff)

The Kanji screen is a kanji explorer; today it degrades a kana candidate to an
"outside the shipped class set" note. Make kana *useful* by reusing the
already-kana-capable Read/analyzer path:

- Kana detail entries → a friendly note + "Look up in Read" (routes the char to
  the analyzer via `openInRead`) instead of the out-of-set note.
- Draw/Camera → an "Open reading in Read" action for the **assembled** detected
  string, so a photographed kana+kanji sentence reaches the morphological
  breakdown. (`findWordCombinations` already surfaces matched sub-words.)
- Fix the camera hint copy ("Kana isn't read" → kana is read).
- Lock kana through the camera text-presence gate (`looksLikeGlyph`) with tests
  (thin/sparse kana must not be rejected as near-empty or as a blob).

`Type` mode stays a kanji explorer (kana belongs in Read's search field).

---

## Execution (maintainer — the model retrains)

```bash
source venv/bin/activate
python -m tools.handwriting_ocr fetch-kanjivg          # if .handwriting-work absent
python -m tools.handwriting_ocr fetch-fonts            # style diversity

# 1. Regenerate the class set WITH kana (the deliberate exception to the
#    runbook's "don't run classes" rule — JMdict unchanged, kana policy changed).
python -m tools.handwriting_ocr classes                # writes kana-inclusive kanji-classes.json (v2)

# 2. Back up baselines (BEFORE export overwrites them), then retrain BOTH models.
cp public/data/kanji-recognizer.onnx .handwriting-work/kanji-recognizer.baseline.onnx
cp public/data/kanji-segmenter.onnx .handwriting-work/kanji-segmenter.baseline.onnx
# --no-resume is REQUIRED on the first run: the class count changed (5454→5599),
# so the head is a different size and a stale last.pt would shape-mismatch.
# Device auto-selects CUDA → MPS → CPU; pass --device to force one.
python -m tools.handwriting_ocr train --no-resume --epochs 30 --patience 8 --val-every 2 --num-workers 6
python -m tools.handwriting_ocr export
# NOTE: segment-train is hardcoded CUDA-or-CPU (segment_train.py) — it runs on CPU
# on a Mac (the segmenter is tiny, so that's tolerable). Patch it to select_device()
# if you want MPS.
python -m tools.handwriting_ocr segment-train
python -m tools.handwriting_ocr segment-export

# 3. Gate: clusters must not regress kanji and must read kana.
python -m tools.handwriting_ocr validate \
    --baseline .handwriting-work/kanji-recognizer.baseline.onnx \
    --candidate public/data/kanji-recognizer.onnx
#   → BOX/HOOK hold; KANA-X (cross-script) + KANA-DAK report sane top-1.

# 4. Ship model + classes TOGETHER (matched pair).
node scripts/fingerprint-recognizer.mjs
git add public/data/kanji-recognizer.onnx public/data/kanji-segmenter.onnx \
        public/data/kanji-classes.json public/data/recognizer-manifest.json \
        public/data/segmenter-manifest.json
```

**Gate before shipping:** kanji clusters (box/hook) hold vs baseline; the new
KANA-X / KANA-DAK clusters read at a sane top-1; in-app Draw of a few kana (あ
か さ が シ ツ ロ) + a mixed word (日本ご) reads correctly and multi-char words
still split. If the loopy-kana cluster is weak, dial `kana_render_policy`'s
elastic/connection down further.

## Known limitations (by design)

- Small kana (っ/ゃ) read as their full form in isolation — recovered only by
  dictionary/context.
- Cross-script homoglyphs (ロ/口, へ/ヘ, ー/一, カ/力 …) are ambiguous in isolation;
  the right answer comes from surrounding script context, not the glyph.
- True fix for both = stroke-order channels (online recognition), deferred.
