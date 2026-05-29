// Multi-character orchestrator. Splits a drawing into characters with the
// boundary segmenter, then runs the existing single-character recognizer on
// each group. Returns one `Candidate[]` per detected character, left-to-right.
//
// The recognizer model is untouched: segmentation is a separate model
// (segmentStrip.ts → the segmenter ONNX). When the segmenter is unavailable
// (older deploy, failed load), we fall back to recognizing the whole drawing
// as a single character — no worse than single-character mode.
//
// Empty input → empty array.

import type { Candidate, Stroke } from "./types";
import type { RecognizerResources } from "./loader";
import { strokesToInput } from "./preprocess";
import { recognize } from "./recognize";
import { splitStrokesByBoundaries } from "./segment";
import { predictBoundaries } from "./segmentStrip";

async function recognizeGroup(
  group: Stroke[],
  resources: RecognizerResources,
  topK: number,
): Promise<Candidate[] | null> {
  const input = strokesToInput(group);
  if (!input) return null;
  const cands = await recognize(resources, input, topK);
  return cands.length ? cands : null;
}

/**
 * Segment + recognize. Returns one `Candidate[]` per detected character,
 * left-to-right.
 */
export async function recognizeMulti(
  strokes: Stroke[],
  resources: RecognizerResources,
  topK: number,
): Promise<Candidate[][]> {
  if (strokes.length === 0) return [];

  // Ask the boundary model where characters split; degrade to "one character"
  // if it isn't loaded or errors at runtime (a segmentation failure must not
  // take down recognition itself).
  let boundaries: number[] = [];
  if (resources.segmenter) {
    try {
      boundaries = await predictBoundaries(resources.segmenter, strokes);
    } catch (err) {
      console.warn("[handwriting] boundary prediction failed; recognizing as one character:", err);
    }
  }
  const groups = splitStrokesByBoundaries(strokes, boundaries);

  const perGroup: (Candidate[] | null)[] = [];
  for (const group of groups) {
    perGroup.push(await recognizeGroup(group, resources, topK));
  }
  return perGroup.filter((c): c is Candidate[] => c !== null);
}
