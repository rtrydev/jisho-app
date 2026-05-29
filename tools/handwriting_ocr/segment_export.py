"""Export the boundary segmenter to ONNX (fp32 — the model is tiny).

Input  ``strip``    : [1, 1, strip_h, strip_w]  (fixed; the app always feeds
                      a single 64×384 strip)
Output ``boundary`` : [1, strip_w // width_stride]  boundary logits per column
"""

from __future__ import annotations

from pathlib import Path

import torch

from .config import SEGMENTER_CHECKPOINT_DIR, SEGMENTER_OUT, EXPORT_POLICY
from .segment_model import BoundaryNet


def _load_best() -> tuple[torch.nn.Module, int, int, int]:
    best = SEGMENTER_CHECKPOINT_DIR / "best.pt"
    if not best.exists():
        raise FileNotFoundError(
            f"No best checkpoint at {best}. Run "
            f"'python -m tools.handwriting_ocr segment-train' first."
        )
    ckpt = torch.load(best, map_location="cpu", weights_only=False)
    strip_h = int(ckpt.get("strip_h", 64))
    strip_w = int(ckpt.get("strip_w", 384))
    width_stride = int(ckpt.get("width_stride", 4))
    model = BoundaryNet(strip_h=strip_h)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    return model, strip_h, strip_w, width_stride


def run(*, log_fn=print) -> Path:
    model, strip_h, strip_w, width_stride = _load_best()
    log_fn(f"loaded best segmenter checkpoint; strip {strip_h}×{strip_w}, stride {width_stride}")
    SEGMENTER_OUT.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 1, strip_h, strip_w)
    # Legacy exporter (dynamo=False) for the same reason as the recognizer
    # export — the TorchDynamo path emits graphs ORT trips over.
    torch.onnx.export(
        model,
        dummy,
        str(SEGMENTER_OUT),
        export_params=True,
        opset_version=EXPORT_POLICY.opset,
        do_constant_folding=True,
        input_names=["strip"],
        output_names=["boundary"],
        dynamic_axes={"strip": {0: "batch"}, "boundary": {0: "batch"}},
        dynamo=False,
    )
    size_kb = SEGMENTER_OUT.stat().st_size / 1024
    log_fn(f"  exported fp32 ONNX: {size_kb:.0f} KB -> {SEGMENTER_OUT.name}")
    return SEGMENTER_OUT
