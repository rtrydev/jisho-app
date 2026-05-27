"""CLI entry: ``python -m tools.handwriting_ocr <subcommand>``.

Subcommands are independent — order is enforced by the README, not by the
driver, so you can re-run any step in isolation.

Available:

  classes        Mine the kanji class set from JMdict.
  fetch-kanjivg  Download + extract the KanjiVG SVG archive.
  fonts          Discover and report installed Japanese fonts.
                 (use ``--list`` to print them)
  train          Run the training loop.
                 (``--epochs N`` and ``--batch-size N`` override config)
  export         Export the best checkpoint to ONNX + quantize.
"""

from __future__ import annotations

import argparse
import sys


def _cmd_classes(args: argparse.Namespace) -> int:
    from . import classes

    classes.run()
    return 0


def _cmd_fetch_kanjivg(args: argparse.Namespace) -> int:
    from . import kanjivg

    kanjivg.fetch(force=args.force)
    return 0


def _cmd_fonts(args: argparse.Namespace) -> int:
    from . import fonts

    if args.list:
        n = fonts.list_fonts()
        return 0 if n > 0 else 1
    n = len(fonts.discover_japanese_fonts())
    print(f"{n} Japanese font(s) discovered; pass --list to see them.")
    return 0 if n > 0 else 1


def _cmd_train(args: argparse.Namespace) -> int:
    from . import train

    train.train(
        epochs=args.epochs,
        batch_size=args.batch_size,
        resume=not args.no_resume,
        limit_classes=args.limit_classes,
        samples_per_class=args.samples_per_class,
        arch=args.arch,
        num_workers=args.num_workers,
        patience=args.patience,
    )
    return 0


def _cmd_export(args: argparse.Namespace) -> int:
    from . import export

    export.run(arch=args.arch)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m tools.handwriting_ocr",
        description="Synthetic-data kanji handwriting OCR training pipeline.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("classes", help="Extract class set from JMdict.")
    sp.set_defaults(func=_cmd_classes)

    sp = sub.add_parser("fetch-kanjivg", help="Download + extract KanjiVG.")
    sp.add_argument("--force", action="store_true", help="Re-download even if cached.")
    sp.set_defaults(func=_cmd_fetch_kanjivg)

    sp = sub.add_parser("fonts", help="Inspect discovered Japanese fonts.")
    sp.add_argument("--list", action="store_true", help="Print each font.")
    sp.set_defaults(func=_cmd_fonts)

    sp = sub.add_parser("train", help="Train the recognizer.")
    sp.add_argument("--epochs", type=int, default=None)
    sp.add_argument("--batch-size", type=int, default=None)
    sp.add_argument(
        "--limit-classes",
        type=int,
        default=None,
        help="Truncate the class list to the first N entries. Smoke-test knob.",
    )
    sp.add_argument(
        "--samples-per-class",
        type=int,
        default=None,
        help="Override TrainPolicy.samples_per_class_per_epoch. Smoke-test knob.",
    )
    sp.add_argument(
        "--arch",
        type=str,
        default="mobilenet_v3_small",
        choices=["mobilenet_v3_small", "mobilenet_v3_small_s1", "simple_resnet"],
        help="Model architecture to train.",
    )
    sp.add_argument(
        "--num-workers",
        type=int,
        default=None,
        help=(
            "DataLoader workers. 0 = main-process synthesis (default; Windows-"
            "safe). >0 enables multiprocessing — each worker re-runs font "
            "discovery + KanjiVG parsing once at startup, then synthesizes "
            "in parallel with GPU training."
        ),
    )
    sp.add_argument(
        "--patience",
        type=int,
        default=None,
        help=(
            "Early-stopping patience. Stop after N epochs without improvement "
            "in best val top-5. None disables. Recommended 5–10 for production "
            "runs based on observed plateau behaviour."
        ),
    )
    sp.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore existing last.pt checkpoint and train from scratch.",
    )
    sp.set_defaults(func=_cmd_train)

    sp = sub.add_parser("export", help="Export the best checkpoint to ONNX.")
    sp.add_argument(
        "--arch",
        type=str,
        default="mobilenet_v3_small",
        choices=["mobilenet_v3_small", "mobilenet_v3_small_s1", "simple_resnet"],
        help="Which trained architecture's best checkpoint to export.",
    )
    sp.set_defaults(func=_cmd_export)

    return p


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
