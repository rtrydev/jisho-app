"""Character-boundary model: 1×H×W strip → 1-D boundary logits over columns.

Two stages:
  1. A 2-D conv trunk collapses height 64→1 while downsampling width by 4
     (→ one feature column per 4 input px).
  2. A 1-D *dilated* conv stack over the width gives each output column a wide
     receptive field (≈ 2+ character widths) so it can tell a between-character
     gap (ink on BOTH sides) from a trailing/leading edge (ink on one side) —
     the failure a small receptive field caused.

Output: one logit per column; a column fires where a character break is. The
recognizer is never touched. ~250k params; trains in minutes on CPU.
"""

from __future__ import annotations

import torch
from torch import nn


def _conv2d(cin: int, cout: int, sw: int) -> nn.Sequential:
    # Height stride is always 2 (collapse H); width stride = sw.
    return nn.Sequential(
        nn.Conv2d(cin, cout, kernel_size=3, stride=(2, sw), padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
    )


def _conv1d(ch: int, dilation: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv1d(ch, ch, kernel_size=3, padding=dilation, dilation=dilation, bias=False),
        nn.BatchNorm1d(ch),
        nn.ReLU(inplace=True),
    )


class BoundaryNet(nn.Module):
    """1×strip_h×W → (W // 4) boundary logits. ``strip_h`` must be 64."""

    def __init__(self, strip_h: int = 64) -> None:
        super().__init__()
        if strip_h != 64:
            raise ValueError(f"BoundaryNet is wired for strip_h=64, got {strip_h}")

        self.trunk = nn.Sequential(
            _conv2d(1, 24, 2),   # H 64→32, W →/2
            _conv2d(24, 48, 2),  # H 32→16, W →/4 (width stride done)
            _conv2d(48, 64, 1),  # H 16→8
            _conv2d(64, 96, 1),  # H 8→4
            _conv2d(96, 96, 1),  # H 4→2
            _conv2d(96, 96, 1),  # H 2→1
        )
        # Wide receptive field along width: dilations 1,2,4,8,16 → RF ≈ ±31
        # output cols ≈ ±124 px ≈ 2.4 character widths each side.
        self.context = nn.Sequential(
            _conv1d(96, 1),
            _conv1d(96, 2),
            _conv1d(96, 4),
            _conv1d(96, 8),
            _conv1d(96, 16),
        )
        self.head = nn.Conv1d(96, 1, kernel_size=1)

        for m in self.modules():
            if isinstance(m, (nn.Conv2d, nn.Conv1d)):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # type: ignore[override]
        x = self.trunk(x)        # (N, 96, 1, W/4)
        x = x.squeeze(2)         # (N, 96, W/4)
        x = self.context(x)      # (N, 96, W/4)
        x = self.head(x)         # (N, 1, W/4)
        return x.squeeze(1)      # (N, W/4) logits


def param_count(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


@torch.no_grad()
def smoke_forward(model: nn.Module, strip_h: int = 64, strip_w: int = 384) -> torch.Size:
    model.eval()
    device = next(model.parameters()).device
    dummy = torch.zeros(1, 1, strip_h, strip_w, device=device)
    return model(dummy).shape
