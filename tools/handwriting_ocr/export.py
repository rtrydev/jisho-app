"""ONNX export + int8 quantization.

Loads the best PyTorch checkpoint, re-builds the model architecture, exports
to ONNX with dynamic batch (fixed CHW = ``1×N×N`` where N is the checkpoint's
trained ``image_size``), and optionally runs post-training dynamic-range
quantization to int8 for the shipped artifact.

The exported model pairs 1:1 with ``public/data/kanji-classes.json``: output
index ``i`` corresponds to ``classes[i]``. Both files ship together.
"""

from __future__ import annotations

from pathlib import Path

import torch

from .classes import load_classes
from .config import (
    CHECKPOINT_DIR,
    EXPORT_POLICY,
    MODEL_FP32_OUT,
    MODEL_OUT,
    SYNTH_POLICY,
)
from .model import build_model


def _load_best_model(arch: str = "simple_resnet") -> tuple[torch.nn.Module, list[str], int]:
    """Returns (model, classes-as-trained, image_size). The shipped class
    index is the checkpoint's class list — that's the contract the model
    output indexes into, regardless of what `kanji-classes.json` currently
    holds. ``image_size`` comes from the checkpoint so the ONNX is exported at
    the resolution the weights were trained for.

    Mirrors ``train.train``'s per-arch checkpoint subdir convention: the
    ``mobilenet_v3_small`` checkpoints live at ``CHECKPOINT_DIR/best.pt``;
    every other arch lands under ``CHECKPOINT_DIR/<arch>/best.pt``.
    """
    ckpt_dir = CHECKPOINT_DIR if arch == "mobilenet_v3_small" else CHECKPOINT_DIR / arch
    best = ckpt_dir / "best.pt"
    if not best.exists():
        raise FileNotFoundError(
            f"No best checkpoint at {best}. Run "
            f"'python -m tools.handwriting_ocr train --arch {arch}' first."
        )
    ckpt = torch.load(best, map_location="cpu", weights_only=False)
    ckpt_classes: list[str] = list(ckpt.get("classes", []))
    if not ckpt_classes:
        raise RuntimeError(f"{best} has no `classes` field — re-train.")
    image_size = int(ckpt.get("image_size", SYNTH_POLICY.image_size))
    model = build_model(num_classes=len(ckpt_classes), arch=arch)  # type: ignore[arg-type]
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    return model, ckpt_classes, image_size


def _export_fp32(model: torch.nn.Module, image_size: int, *, log_fn=print) -> Path:
    MODEL_FP32_OUT.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 1, image_size, image_size)
    # `dynamo=False` requests the legacy TorchScript-based exporter. The new
    # TorchDynamo exporter (default in torch 2.12) emits a graph that
    # onnxruntime's quantizer chokes on with a shape-inference mismatch
    # between MobileNetV3's trunk output (576 ch) and the classifier head
    # (1024 ch). Legacy export passes through cleanly.
    torch.onnx.export(
        model,
        dummy,
        str(MODEL_FP32_OUT),
        export_params=True,
        opset_version=EXPORT_POLICY.opset,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        dynamo=False,
    )
    size_mb = MODEL_FP32_OUT.stat().st_size / (1024 * 1024)
    log_fn(f"  exported fp32 ONNX: {size_mb:.2f} MB -> {MODEL_FP32_OUT.name}")
    return MODEL_FP32_OUT


def _quantize_dynamic(src: Path) -> Path:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    quantize_dynamic(
        model_input=str(src),
        model_output=str(MODEL_OUT),
        weight_type=QuantType.QInt8,
    )
    return MODEL_OUT


def _convert_fp16(src: Path) -> Path:
    from onnxconverter_common import float16
    import onnx

    model = onnx.load(str(src))
    converted = float16.convert_float_to_float16(model, keep_io_types=True)
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(converted, str(MODEL_OUT))
    return MODEL_OUT


def run(*, arch: str = "simple_resnet", log_fn=print) -> Path:
    model, classes, image_size = _load_best_model(arch=arch)
    log_fn(f"loaded best checkpoint; arch={arch}; {len(classes):,} classes; image_size={image_size}")
    # Cross-check against the current on-disk class list as a guardrail —
    # warn (don't fail) when the checkpoint was trained on a different /
    # truncated subset (smoke runs use --limit-classes).
    try:
        on_disk = load_classes()
    except FileNotFoundError:
        on_disk = []
    if on_disk and on_disk[: len(classes)] != classes:
        log_fn(
            "  WARN: checkpoint classes differ from the prefix of "
            "public/data/kanji-classes.json — the shipped ONNX will use "
            "the checkpoint's classes."
        )

    fp32 = _export_fp32(model, image_size, log_fn=log_fn)

    mode = EXPORT_POLICY.quantization
    if mode == "dynamic":
        out = _quantize_dynamic(fp32)
    elif mode == "fp16":
        out = _convert_fp16(fp32)
    elif mode == "none":
        # Copy fp32 to the shipped path so consumers always read from MODEL_OUT.
        MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
        MODEL_OUT.write_bytes(fp32.read_bytes())
        out = MODEL_OUT
    else:
        raise ValueError(f"unknown quantization mode: {mode!r}")

    size_mb = out.stat().st_size / (1024 * 1024)
    log_fn(f"  shipped artifact ({mode}): {size_mb:.2f} MB -> {out.name}")
    return out
