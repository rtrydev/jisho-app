"""PyTorch Dataset that synthesizes training samples on the fly.

A sample is built per ``__getitem__`` call: pick a class, decide whether to
render from a font or from KanjiVG-perturbed strokes, then apply the full
image-space augmentation pipeline. No pre-rendered images on disk — the
synthesis loop is fast enough that the bottleneck is GPU, not data.

Determinism:

* The training dataset varies the RNG seed per epoch so each pass sees a
  fresh distribution of synthetic samples.
* The validation dataset uses a seed derived from ``(class_idx, instance_idx)``
  alone, so a given index produces the same image every epoch — a real
  validation signal, not noise.
"""

from __future__ import annotations

import random
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from .augment import augment
from .config import SYNTH_POLICY, SynthesisPolicy
from .fonts import discover_japanese_fonts, rasterize_with_font
from .kanjivg import has_strokes, rasterize_with_perturbation


def _seed_rng(seed: int) -> random.Random:
    return random.Random(seed)


class SyntheticKanjiDataset(Dataset):
    """One synthetic sample per index.

    Parameters
    ----------
    classes : list[str]
        Ordered class list (index = label).
    samples_per_class : int
        Logical sample count per class per epoch.
    base_seed : int
        Deterministic seed base. The training driver bumps this per epoch
        to refresh the synthesis distribution; validation pins it.
    deterministic : bool
        When True, the seed for sample ``i`` does not depend on
        ``epoch_seed_offset``. Use for the validation split.
    policy : SynthesisPolicy
        The synthesis distribution. Train and val pass *different* policies
        (heavier vs. deployment-proxy) — every renderer/augmentation knob is
        read from here, not from the module global.
    """

    def __init__(
        self,
        classes: list[str],
        samples_per_class: int,
        base_seed: int,
        *,
        deterministic: bool = False,
        policy: SynthesisPolicy = SYNTH_POLICY,
    ) -> None:
        self.classes = classes
        self.samples_per_class = samples_per_class
        self.base_seed = base_seed
        self.deterministic = deterministic
        self._policy = policy
        self._epoch = 0

        fonts = discover_japanese_fonts()
        # Each entry is (path, face_index). face_index distinguishes the
        # sub-faces packed inside .ttc files; it's 0 for plain TTF/OTF.
        self._fonts: list[tuple[Path, int]] = list(fonts)
        if not self._fonts:
            # No fonts discovered — KanjiVG-only synthesis is still valid
            # though the print/handwriting variety drops. Caller should see
            # this in the logs.
            self._effective_p_kanjivg = 1.0
        else:
            self._effective_p_kanjivg = policy.p_kanjivg

        # Precompute which classes have KanjiVG coverage; fall back to font
        # for the rest. Cheap (one cache hit per class, sub-second total).
        self._has_kvg: list[bool] = [has_strokes(c) for c in classes]

    @property
    def font_count(self) -> int:
        return len(self._fonts)

    @property
    def kanjivg_coverage(self) -> float:
        if not self.classes:
            return 0.0
        return sum(self._has_kvg) / len(self.classes)

    def set_epoch(self, epoch: int) -> None:
        """Train-time only. Validation ignores epoch and stays deterministic."""
        self._epoch = epoch

    def __len__(self) -> int:
        return len(self.classes) * self.samples_per_class

    def _seed_for(self, idx: int) -> int:
        if self.deterministic:
            return self.base_seed + idx
        # Mix in epoch so each pass sees fresh randomness.
        return self.base_seed + self._epoch * 1_000_003 + idx

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        class_idx = idx % len(self.classes)
        ch = self.classes[class_idx]
        rng = _seed_rng(self._seed_for(idx))

        # Decide synthesis path. Force fonts when KanjiVG has no coverage
        # for this character, otherwise honor the configured mix.
        use_kvg = self._has_kvg[class_idx] and rng.random() < self._effective_p_kanjivg

        pol = self._policy
        arr: np.ndarray | None = None
        if use_kvg:
            arr = rasterize_with_perturbation(
                ch, pol.image_size, rng=rng, policy=pol
            )
        if arr is None:
            if not self._fonts:
                # Defensive: KanjiVG should have covered this; if not, emit
                # a blank rather than crash. Tests can catch this with the
                # zero-image assertion in eval.
                arr = np.zeros(
                    (pol.image_size, pol.image_size),
                    dtype=np.float32,
                )
            else:
                font_path, face_index = self._fonts[rng.randrange(len(self._fonts))]
                arr = rasterize_with_font(
                    ch,
                    font_path,
                    pol.image_size,
                    index=face_index,
                    rng=rng,
                    policy=pol,
                )

        arr = augment(arr, rng, pol)

        # (1, H, W) float32 — matches the model's expected input shape.
        tensor = torch.from_numpy(arr).unsqueeze(0).contiguous()
        return tensor, class_idx
