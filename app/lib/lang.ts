// Tiny script-based language detector for the EN ↔ JP search router.
//
// The detection signal is intentionally coarse: presence of any kana or CJK
// ideograph anywhere in the string means "treat this as Japanese." That keeps
// mixed input ("the 先生 said hello") in the JP pipeline, which is correct —
// the JP analyzer happily tokenizes around Latin characters, while the EN
// reverse-index path would discard the kanji entirely.
//
// The detector is intentionally unaware of empty input; callers handle the
// idle state themselves (the placeholder should hint at *both* directions
// when the field is empty, not pre-commit to one).

export type Direction = "ja" | "en";

// Hiragana (U+3040–309F), katakana (U+30A0–30FF), CJK Unified Ideographs
// (U+4E00–9FFF), plus half-width katakana (U+FF66–FF9F). Half-width is rare
// in modern text but trivial to include and avoids a footgun for pastes from
// receipts and legacy data dumps.
const JP_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/;

export function detectLanguage(text: string): Direction {
  return JP_RE.test(text) ? "ja" : "en";
}
