"""Handwriting OCR — synthetic data + CNN training pipeline.

Companion to ``tools.data_pipeline``. Produces a small CJK-character
classifier shipped to the browser as ONNX for the handwriting kanji-lookup
feature. See ``README.md`` for the full pipeline.

The pipeline is structured as discrete subcommands rather than one driver
because the steps have very different runtimes (class extraction is
seconds, KanjiVG fetch is one-time, training is hours, export is seconds)
and you re-run them independently.
"""
