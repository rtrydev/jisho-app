// Multi-character orchestrator: segments the strokes left-to-right, runs the
// existing single-character recognizer per cluster, and re-splits any cluster
// whose top-1 confidence falls below the threshold (provided the split halves
// individually beat the merged result).
//
// Returns one Candidate[] per detected character, in reading order. Empty
// input → empty array. Single-character drawings round-trip identically to a
// plain `recognize` call: segmenter yields one group, confidence is high, no
// re-split happens.

import type { Candidate, Stroke } from "./types";
import type { RecognizerResources } from "./loader";
import { strokesToInput } from "./preprocess";
import { recognize } from "./recognize";
import { segmentStrokes, splitGroupAtLargestGap } from "./segment";

const RESPLIT_TUNING = {
  /** Top-1 softmax probability below which we attempt a re-split. */
  confidenceThreshold: 0.4,
  /** Maximum re-split depth. Two means one initial pass plus one recursive split per branch — enough to turn a 2- or 3-kanji blob into individual characters without blowing up inference cost on noisy input. */
  maxDepth: 2,
} as const;

async function recognizeOne(
  group: Stroke[],
  resources: RecognizerResources,
  topK: number,
): Promise<Candidate[]> {
  const input = strokesToInput(group);
  if (!input) return [];
  return recognize(resources, input, topK);
}

async function recognizeWithSplit(
  group: Stroke[],
  resources: RecognizerResources,
  topK: number,
  depth: number,
): Promise<Candidate[][]> {
  const candidates = await recognizeOne(group, resources, topK);
  if (candidates.length === 0) return [];
  const top1 = candidates[0];

  // Stop conditions: confident enough, depth budget exhausted, or nothing
  // left to split.
  if (
    top1.score >= RESPLIT_TUNING.confidenceThreshold ||
    depth >= RESPLIT_TUNING.maxDepth ||
    group.length < 2
  ) {
    return [candidates];
  }

  const sub = splitGroupAtLargestGap(group);
  if (!sub) return [candidates];

  // Recurse sequentially — ORT-web sessions serialize internally so parallel
  // awaits just queue up; keeping it sequential makes the cost predictable.
  const subResults: Candidate[][] = [];
  for (const part of sub) {
    const inner = await recognizeWithSplit(part, resources, topK, depth + 1);
    for (const r of inner) subResults.push(r);
  }
  if (subResults.length === 0) return [candidates];

  // Accept the split only if every piece is more confident than the merged
  // result. Otherwise we'd risk turning one solid prediction into two weaker
  // ones — better to leave it merged and let the user redraw.
  const minSubTop1 = Math.min(...subResults.map((c) => c[0]?.score ?? 0));
  if (minSubTop1 > top1.score) return subResults;
  return [candidates];
}

/**
 * Segment + recognize. Returns one Candidate[] per detected character,
 * left-to-right.
 */
export async function recognizeMulti(
  strokes: Stroke[],
  resources: RecognizerResources,
  topK: number,
): Promise<Candidate[][]> {
  if (strokes.length === 0) return [];
  const groups = segmentStrokes(strokes);
  if (groups.length === 0) return [];

  const results: Candidate[][] = [];
  for (const group of groups) {
    const groupResults = await recognizeWithSplit(group, resources, topK, 0);
    for (const r of groupResults) results.push(r);
  }
  return results;
}
