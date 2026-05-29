// Shared types for the handwriting kanji-lookup feature. Kept separate from
// the engine layer (app/lib/engine/) — the recognizer doesn't see vocabulary
// or grammar data, and the engine doesn't know about strokes.

/** A single stroke as a sequence of pointer samples in canvas pixel space. */
export type Stroke = ReadonlyArray<{ x: number; y: number }>;

export type Candidate = {
  /** The predicted character. */
  char: string;
  /** Softmax probability in [0, 1]. */
  score: number;
  /** Index into the kanji-classes.json `classes` array (= model output). */
  classIndex: number;
};

export type RecognizerStatus =
  | { kind: "idle" }
  | { kind: "loading"; step: string; progress: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export type KanjiClassesManifest = {
  schema: string;
  policy: Record<string, unknown>;
  count: number;
  classes: string[];
};

export type RecognizerManifest = {
  schema: string;
  /** Model filename, relative to /data/. */
  model: string;
  /** Short content hash, appended to the model URL as `?v=` to bust caches
   *  when the bytes change. Produced by scripts/fingerprint-recognizer.mjs. */
  version: string;
};
