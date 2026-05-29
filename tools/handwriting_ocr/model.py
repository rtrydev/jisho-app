"""Models: 1-channel 64×64 → N-way softmax.

Multiple architectures available via ``build_model(num_classes, arch=...)``:

* ``mobilenet_v3_small`` (default) — torchvision MobileNetV3-Small with a
  1-channel stem. ~1.55M params. Designed for 224×224; at 64×64 input the
  trunk downsamples 5× to a 2×2 feature map, which is borderline lossy.
* ``mobilenet_v3_small_s1`` — same trunk but with stem stride 1 instead of
  stride 2, so the trunk only downsamples 4× to 4×4 features. ~1.55M
  params; slower per step but more spatial info preserved.
* ``simple_resnet`` — custom 4-stage residual CNN designed for 64×64. Three
  stride-2 stages → 8×8 feature map. ~700k params; smaller than MobileNet
  but with more spatial resolution at the head.

The 64×64 input + heavy synthetic augmentation regime is significantly
different from the standard ImageNet recipe MobileNetV3 was designed for,
so it's worth comparing.
"""

from __future__ import annotations

from typing import Literal

import torch
from torch import nn
from torchvision.models import mobilenet_v3_small


Arch = Literal["mobilenet_v3_small", "mobilenet_v3_small_s1", "simple_resnet"]


def _swap_stem_to_one_channel(model: nn.Module, *, stride: int | None = None) -> None:
    """In-place replace MobileNet's 3→16 stride-2 stem with a 1→16 variant."""
    old = model.features[0][0]
    new_stem = nn.Conv2d(
        in_channels=1,
        out_channels=old.out_channels,
        kernel_size=old.kernel_size,
        stride=stride if stride is not None else old.stride,
        padding=old.padding,
        bias=old.bias is not None,
    )
    nn.init.kaiming_normal_(new_stem.weight, mode="fan_out", nonlinearity="relu")
    if new_stem.bias is not None:
        nn.init.zeros_(new_stem.bias)
    model.features[0][0] = new_stem


def _build_mobilenet_v3_small(num_classes: int, *, stem_stride: int = 2) -> nn.Module:
    model = mobilenet_v3_small(weights=None, num_classes=num_classes)
    _swap_stem_to_one_channel(model, stride=stem_stride)
    return model


class _ResBlock(nn.Module):
    """Pre-activation residual block. Identity shortcut when in=out; 1x1
    projection otherwise. Stride lives on the first conv when downsampling."""

    def __init__(self, in_ch: int, out_ch: int, stride: int = 1) -> None:
        super().__init__()
        self.bn1 = nn.BatchNorm2d(in_ch)
        self.conv1 = nn.Conv2d(in_ch, out_ch, kernel_size=3, stride=stride, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(out_ch)
        self.conv2 = nn.Conv2d(out_ch, out_ch, kernel_size=3, stride=1, padding=1, bias=False)
        if stride != 1 or in_ch != out_ch:
            self.shortcut = nn.Conv2d(in_ch, out_ch, kernel_size=1, stride=stride, bias=False)
        else:
            self.shortcut = nn.Identity()
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        out = self.conv1(self.relu(self.bn1(x)))
        out = self.conv2(self.relu(self.bn2(out)))
        return out + self.shortcut(x)


class SimpleResNet64(nn.Module):
    """Compact pre-activation ResNet purpose-built for 1×64×64 input.

    Stem keeps spatial resolution (stride 1), then three stride-2 stages
    drop it 64→32→16→8. The 8×8 feature map at the head is 16× the spatial
    resolution MobileNetV3-Small has at the same input size, so the
    classifier sees more discriminative structure for kanji that differ
    in fine layout.
    """

    def __init__(self, num_classes: int) -> None:
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(1, 32, kernel_size=3, stride=1, padding=1, bias=False),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
        )
        # Stage 1: 64→32 spatial, 32→64 channels, 2 blocks.
        self.stage1 = nn.Sequential(_ResBlock(32, 64, stride=2), _ResBlock(64, 64))
        # Stage 2: 32→16 spatial, 64→128 channels.
        self.stage2 = nn.Sequential(_ResBlock(64, 128, stride=2), _ResBlock(128, 128))
        # Stage 3: 16→8 spatial, 128→192 channels.
        self.stage3 = nn.Sequential(_ResBlock(128, 192, stride=2), _ResBlock(192, 192))
        self.head_bn = nn.BatchNorm2d(192)
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.fc = nn.Linear(192, num_classes)
        # Kaiming init for the conv layers.
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        x = self.stem(x)
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        x = torch.relu(self.head_bn(x))
        x = self.pool(x).flatten(1)
        return self.fc(x)


def build_model(num_classes: int, arch: Arch = "mobilenet_v3_small") -> nn.Module:
    if arch == "mobilenet_v3_small":
        return _build_mobilenet_v3_small(num_classes, stem_stride=2)
    if arch == "mobilenet_v3_small_s1":
        return _build_mobilenet_v3_small(num_classes, stem_stride=1)
    if arch == "simple_resnet":
        return SimpleResNet64(num_classes)
    raise ValueError(f"unknown arch: {arch!r}")


def select_device(prefer: str | None = None) -> torch.device:
    """Pick the best available torch device, or honour an explicit override.

    ``prefer`` of ``None``/``"auto"`` resolves in order CUDA → Apple MPS
    (Metal, on Mac) → CPU. Pass ``"cuda"``/``"mps"``/``"cpu"`` to force one
    (e.g. to fall back to CPU if an MPS op misbehaves). AMP/GradScaler stay
    CUDA-only — MPS and CPU run fp32 — so the rest of the loop needs no
    per-device branching beyond the ``device.type == "cuda"`` guards already
    present.
    """
    if prefer and prefer != "auto":
        return torch.device(prefer)
    if torch.cuda.is_available():
        return torch.device("cuda")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def param_count(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


@torch.no_grad()
def smoke_forward(model: nn.Module, image_size: int = 64) -> torch.Size:
    """Sanity check: a single forward pass with a synthetic batch."""
    model.eval()
    # Pull device from the model's parameters so this works on CUDA too.
    device = next(model.parameters()).device
    dummy = torch.zeros(1, 1, image_size, image_size, device=device)
    out = model(dummy)
    return out.shape
