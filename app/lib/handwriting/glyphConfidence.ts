// Recognizer-side half of the camera text-presence gate (see imagePreprocess.ts
// `looksLikeGlyph` for the pixel-side half).
//
// The recognizer has no garbage class and a low-magnitude softmax — a *correct*
// kanji often peaks at only ~0.05–0.20 (see app/lib/analyzer.ts) — so an
// absolute top-1 confidence floor can't tell a real character from a misread.
// But a genuine glyph still concentrates its probability mass on a handful of
// visually-similar kanji, whereas a non-character (a leftover scrap of a random
// photo) spreads mass ~uniformly across the thousands of classes. The summed
// top-K mass separates the two by a wide margin, so a deliberately LOW floor
// rejects "there is no character here" without discarding a genuine
// low-confidence read.
//
// With K = 12 over 5,454 classes, a uniform distribution sums to ~0.0022; a real
// glyph's top-12 mass is comfortably > 0.1 even when its peak is ~0.05. The
// default floor sits an order of magnitude above uniform and well below any real
// read.

import type { Candidate } from "./types";

/** Default summed-top-K-mass floor below which a group is "no character". */
export const MIN_GLYPH_MASS = 0.02;

/** Sum of the candidate softmax scores (the recognizer's top-K mass). */
export function topKMass(group: Candidate[]): number {
  let sum = 0;
  for (const c of group) sum += c.score;
  return sum;
}

/** True when the recognizer concentrated enough mass to indicate a character
 *  (rather than a near-uniform spread over a non-text region). */
export function hasGlyphStructure(group: Candidate[], floor = MIN_GLYPH_MASS): boolean {
  return group.length > 0 && topKMass(group) >= floor;
}

/** Drop groups that don't read as a character. Used by the camera path after
 *  recognition to keep garbage off-screen. */
export function filterGlyphGroups(
  groups: Candidate[][],
  floor = MIN_GLYPH_MASS,
): Candidate[][] {
  return groups.filter((g) => hasGlyphStructure(g, floor));
}
