"""CLI entry: ``python -m tools.handwriting_ocr <subcommand>``.

Subcommands are independent — order is enforced by the README, not by the
driver, so you can re-run any step in isolation.

Available:

  classes        Mine the kanji class set from JMdict.
  fetch-kanjivg  Download + extract the KanjiVG SVG archive.
  fetch-fonts    Download the curated OFL font pack into the work dir.
  fonts          Discover and report installed Japanese fonts.
                 (use ``--list`` to print them)
  train          Run the training loop.
                 (``--epochs N`` and ``--batch-size N`` override config)
  eval           Head-to-head: a candidate checkpoint vs the deployed
                 baseline on the deployment-proxy distribution.
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


def _cmd_fetch_fonts(args: argparse.Namespace) -> int:
    from . import font_pack

    counts = font_pack.fetch_fonts(force=args.force)
    # Treat a zero-font outcome as a failure so CI catches it; otherwise
    # success — having some cached but no new downloads is still fine.
    return 0 if (counts["downloaded"] + counts["cached"]) > 0 else 1


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
        val_every=args.val_every,
    )
    return 0


def _cmd_eval(args: argparse.Namespace) -> int:
    from . import eval as eval_mod

    return eval_mod.run(
        arch=args.arch,
        candidate=args.candidate,
        candidate_image_size=args.candidate_image_size,
        baseline=args.baseline,
        baseline_arch=args.baseline_arch,
        baseline_image_size=args.baseline_image_size,
        condition=args.condition,
        samples_per_class=args.samples_per_class,
        num_workers=args.num_workers,
    )


def _cmd_export(args: argparse.Namespace) -> int:
    from . import export

    export.run(arch=args.arch)
    return 0


def _cmd_segment_train(args: argparse.Namespace) -> int:
    from . import segment_train

    kwargs = {}
    if args.epochs is not None:
        kwargs["epochs"] = args.epochs
    if args.batch_size is not None:
        kwargs["batch_size"] = args.batch_size
    if args.train_samples is not None:
        kwargs["train_samples"] = args.train_samples
    if args.num_workers is not None:
        kwargs["num_workers"] = args.num_workers
    segment_train.train(**kwargs)
    return 0


def _cmd_segment_export(args: argparse.Namespace) -> int:
    from . import segment_export

    segment_export.run()
    return 0


def _cmd_segment_validate(args: argparse.Namespace) -> int:
    from . import segment_validate

    return segment_validate.run(trials=args.trials)


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

    sp = sub.add_parser(
        "fetch-fonts", help="Download the curated OFL Japanese font pack."
    )
    sp.add_argument("--force", action="store_true", help="Re-download even if cached.")
    sp.set_defaults(func=_cmd_fetch_fonts)

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
        default="simple_resnet",
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
        "--val-every",
        type=int,
        default=None,
        help=(
            "Run the validation pass every N epochs. Default 1 (every epoch). "
            "Epoch 0 (baseline) and the final epoch are always validated, the "
            "rest by stride N. Skipping val on most epochs is a meaningful "
            "speedup on long runs since the val pass is a full forward sweep."
        ),
    )
    sp.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore existing last.pt checkpoint and train from scratch.",
    )
    sp.set_defaults(func=_cmd_train)

    sp = sub.add_parser(
        "eval",
        help="Head-to-head: candidate checkpoint vs deployed baseline.",
    )
    sp.add_argument(
        "--arch",
        type=str,
        default="simple_resnet",
        choices=["mobilenet_v3_small", "mobilenet_v3_small_s1", "simple_resnet"],
        help="Candidate architecture (selects the default checkpoint path).",
    )
    sp.add_argument(
        "--candidate",
        type=str,
        default=None,
        help="Path to the candidate checkpoint (default: best.pt for --arch).",
    )
    sp.add_argument(
        "--candidate-image-size",
        type=int,
        default=None,
        help="Override candidate input size (default: read from the checkpoint).",
    )
    sp.add_argument(
        "--baseline",
        type=str,
        default=None,
        help="Path to the baseline checkpoint (default: checkpoints/deployed_baseline.pt).",
    )
    sp.add_argument(
        "--baseline-arch",
        type=str,
        default=None,
        choices=["mobilenet_v3_small", "mobilenet_v3_small_s1", "simple_resnet"],
        help="Baseline architecture (default: from checkpoint / autodetected).",
    )
    sp.add_argument(
        "--baseline-image-size",
        type=int,
        default=None,
        help="Override baseline input size (default: from checkpoint, else 64).",
    )
    sp.add_argument(
        "--condition",
        type=str,
        default="deployment",
        help="Which distribution to score on: deployment (default) | clean | train | all.",
    )
    sp.add_argument(
        "--samples-per-class",
        type=int,
        default=6,
        help="Samples per class per condition (default 6).",
    )
    sp.add_argument(
        "--num-workers",
        type=int,
        default=4,
        help="DataLoader workers for synthesis (default 4).",
    )
    sp.set_defaults(func=_cmd_eval)

    sp = sub.add_parser("export", help="Export the best checkpoint to ONNX.")
    sp.add_argument(
        "--arch",
        type=str,
        default="simple_resnet",
        choices=["mobilenet_v3_small", "mobilenet_v3_small_s1", "simple_resnet"],
        help="Which trained architecture's best checkpoint to export.",
    )
    sp.set_defaults(func=_cmd_export)

    # --- Character-boundary segmenter (separate small model) ------------- #
    sp = sub.add_parser("segment-train", help="Train the character-boundary segmenter.")
    sp.add_argument("--epochs", type=int, default=None)
    sp.add_argument("--batch-size", type=int, default=None)
    sp.add_argument("--train-samples", type=int, default=None, help="Synthetic strips per epoch.")
    sp.add_argument("--num-workers", type=int, default=None, help="DataLoader workers (default 4).")
    sp.set_defaults(func=_cmd_segment_train)

    sp = sub.add_parser("segment-export", help="Export the segmenter to ONNX (fp32).")
    sp.set_defaults(func=_cmd_segment_export)

    sp = sub.add_parser(
        "segment-validate",
        help="Gate: boundary count + end-to-end split→recognize on rendered words.",
    )
    sp.add_argument("--trials", type=int, default=8, help="Trials per test word.")
    sp.set_defaults(func=_cmd_segment_validate)

    return p


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
