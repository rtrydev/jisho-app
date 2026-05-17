// Internal engine types. Public consumers see the friendlier shapes in
// `app/lib/analyzer.ts`; nothing outside `app/lib/engine/` should import this.

export type RawToken = {
  surface_form: string;
  basic_form: string;
  pos: string;
  pos_detail_1?: string;
  reading?: string;
};

export type TokenizerLike = {
  tokenize(text: string): RawToken[];
};

export type VocabSense = {
  pos: string[];
  glosses: string[];
  misc?: string[];
};

export type VocabEntry = {
  r: string[];
  s: VocabSense[];
  e?: number[];
  f?: number;
};

export type DictionaryMeta = {
  version?: string;
  words?: number;
  sentences?: number;
  description?: string;
  [k: string]: unknown;
};

export type Dictionary = {
  meta: DictionaryMeta;
  words: Record<string, VocabEntry>;
  readings: Record<string, string[]>;
  sentences: Array<[string, string]>;
};

// Yomitan v3 term-bank entry: an 8-tuple
//   [0] expression — the headword
//   [1] reading (kana)
//   [2] term tags — used here as the kana display reading (often == [1])
//   [3] rule identifiers
//   [4] score
//   [5] glossary — structured-content node array
//   [6] sequence number
//   [7] definition tags — JLPT level ("N1".."N5")
export type GrammarEntry = [
  string,
  string,
  string,
  string,
  number,
  unknown[],
  number,
  string,
];

export type GrammarMap = Map<string, GrammarEntry>;

export type GrammarManifest = {
  version?: number;
  artifacts: Array<{
    path: string;
    encoding?: "gzip" | "identity";
    entries?: number;
    format?: string;
    sha256?: string;
  }>;
  source?: Record<string, unknown>;
};

export type EngineResources = {
  dictionary: Dictionary;
  grammar: GrammarMap;
  tokenizer: TokenizerLike;
};
