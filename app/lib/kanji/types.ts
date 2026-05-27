// Runtime types for the kanji + radical-search artifacts produced by
// Stage 7 of tools.data_pipeline. Field names match the gzipped JSON
// payloads (short single-letter keys to keep the wire small).

export type KanjiInfo = {
  /** Stroke count. */
  s: number;
  /** Old JLPT level 1–4 (KANJIDIC2 ships these, not the new N1–N5). */
  j?: number;
  /** Japanese school grade 1–10. */
  g?: number;
  /** Frequency rank (1 = most common). */
  f?: number;
  /** On'yomi readings (katakana). */
  on?: string[];
  /** Kun'yomi readings (hiragana, with `.` separating okurigana). */
  kun?: string[];
  /** English meanings. */
  m?: string[];
  /** Radicals the character contains (deterministic order by stroke count). */
  r?: string[];
};

export type KanjiManifest = {
  schema: "kanji/v1";
  count: number;
  data: Record<string, KanjiInfo>;
};

export type RadicalMeta = {
  /** The radical character itself. */
  c: string;
  /** Stroke count of the radical (used for the section grouping). */
  s: number;
};

export type RadkfileManifest = {
  schema: "radkfile/v1";
  /** Ordered kanji list — bitset position `i` corresponds to classes[i]. */
  classes: string[];
  radicals: RadicalMeta[];
  /** radical char → indices into `classes`. Indices are sorted ascending. */
  byRadical: Record<string, number[]>;
};

export type KanjiDataStatus =
  | { kind: "idle" }
  | { kind: "loading"; step: string; progress: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };
