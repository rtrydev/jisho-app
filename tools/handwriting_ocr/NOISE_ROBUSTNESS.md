# Junk & noise robustness — input-side filtering + the clutter knob

How the OCR pipeline keeps junk ink (camera noise, stray drawing dots) from
breaking recognition, and what the training pipeline does about the junk that
filtering can't remove. Written alongside the multi-line camera segmentation
work (June 2026); the model-side knob only takes effect at the next retrain
(see `RETRAIN_RUNBOOK.md`).

## The failure mode

The recognizer reads a tightly-cropped 96² cell: the input is bbox-fit, so
**any foreign ink inside a cell moves/shrinks the real glyph** in the model
input — recognition then fails even though the character itself was captured
cleanly. Junk also creates phantom cells of its own; those are largely handled
by the two existing text-presence gates (structural `looksLikeGlyph` +
summed top-K mass, see `imagePreprocess.ts` / `glyphConfidence.ts`). The
bbox-corruption path had no defense.

## Input-side filtering (implemented, no retrain needed)

Layered in `app/lib/handwriting/imagePreprocess.ts` (camera) and
`app/lib/handwriting/segment.ts` (draw):

1. **Pass-1 component cleanup** (camera): frame-spanning rules/bands +
   micro-specks. The speck floor is now scale-independent
   (`TINY_SPECK_FLOOR_FRAC`); the old image-relative `0.0008·w·h` floor
   assumed one full-height line and was bigger than a dakuten on a dense
   multi-line crop.
2. **Glyph-relative speck pruning** (camera): after line detection fixes the
   em, components `< SPECK_EM_FRAC·em²` are zeroed — "small" finally means
   "small relative to a character", at every text size.
3. **Noise-band + clipped-line filters** (camera): a line band whose mass is
   a sliver of the densest band's is junk; a sub-median band touching the
   crop edge is the neighbouring line the guide box sliced through.
4. **Per-cell component exclusion** (camera): inside a cell, a component that
   is both `< CELL_MINOR_AREA_FRAC` of the dominant component and farther
   than `CELL_CORE_GAP_FRAC·em` from the glyph core is excluded from the
   bbox fit *and* zeroed in the copied pixels — this is the direct fix for
   the bbox-corruption path. Detached real parts (dakuten, the dots of 心)
   are bigger or hug the core, so they stay.
5. **Stray-stroke veto** (draw, `pruneStrayStrokes`): a stroke tiny relative
   to the em AND far from the union of the real strokes (an accidental
   tap/palm graze) is dropped before the segmenter strip is rendered.

## Model-side options considered (synthetic-only constraint)

### Garbage class — rejected

Append a 5455th "not a character" class trained on synthetic junk. Rejected:

- The two deployed gates already answer "is there a character here?" without
  touching the model contract; a garbage class would mostly duplicate them.
- It changes the `kanji-classes.json` ↔ logits contract and every downstream
  consumer (top-K mass semantics break: garbage mass would need special
  handling in `glyphConfidence.ts`).
- Synthetic junk can't enumerate real-world negatives; the bigger risk is the
  model learning "degraded glyph → garbage", rejecting exactly the marginal
  real characters the low-floor mass gate was designed to keep.

### Residual-clutter augmentation — implemented (`p_clutter`)

The remaining gap is junk that **touches or hugs a character**: filtering
can't remove it without risking real ink, so it survives into the cell, and a
model that never saw foreign ink treats the cell as OOD. The fix mirrors the
sharpness-invariance lesson (`RECOGNIZER_CHALLENGES.md`): make the region
in-distribution instead of pretending it can't occur.

`SynthesisPolicy.p_clutter` (default 0.12) adds 1–3 small foreign marks
(dots/short bars) per affected sample, confined to the border band of the
image (`clutter_edge_band_frac`) — after the bbox fit, that's where cell junk
lands. Guard rails, in keeping with the identity-preservation rule:

- Marks never enter the glyph interior (the inward extent is clamped to the
  band), so they can't read as an extra stroke.
- **Kana render with `p_clutter=0`** (`kana_render_policy`): a border mark at
  a kana's top-right is a dakuten look-alike (か↔が hazard).
- `VAL_POLICY` keeps `p_clutter=0` — best.pt selection stays anchored to
  clean stylus strokes, the primary Draw input.

Validation: `eval` gained a `clutter` condition (`VAL_POLICY` with clutter
forced on) to measure this axis explicitly. The ship gate is unchanged — the
candidate must still beat the baseline on `deployment`; `clutter` should
improve without `clean`/`freehand` regressing. If `clean` regresses, dial
`p_clutter` down before reaching for anything else.

## Status

- Input-side filtering: live (TypeScript, no model change).
- `p_clutter`: in the training config, **inert until the next retrain +
  export** — the shipped ONNX is unchanged. Follow `RETRAIN_RUNBOOK.md`; when
  evaluating, add `--condition all` (now includes `clutter`) to the step-4
  comparison.
