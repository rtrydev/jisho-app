// Pure inference helper: given preprocessed input and loaded resources,
// returns the top-K candidates by softmax probability.

import type { Candidate } from "./types";
import type { RecognizerResources } from "./loader";
import { HANDWRITING_INPUT_SIZE } from "./preprocess";

export async function recognize(
  resources: RecognizerResources,
  input: Float32Array,
  topK = 8,
): Promise<Candidate[]> {
  // Lazy import to avoid pulling onnxruntime-web into any module that
  // imports this purely for the function type.
  // Match loader.ts: the /wasm subpath ships only the non-JSEP runtime that
  // sync-onnx-runtime.mjs copies into /public/onnx/.
  const ort = await import("onnxruntime-web/wasm");
  const tensor = new ort.Tensor("float32", input, [
    1,
    1,
    HANDWRITING_INPUT_SIZE,
    HANDWRITING_INPUT_SIZE,
  ]);
  const inputName = resources.session.inputNames[0];
  const outputName = resources.session.outputNames[0];
  const feeds: Record<string, import("onnxruntime-web").Tensor> = {
    [inputName]: tensor,
  };
  const results = await resources.session.run(feeds);
  const logitsTensor = results[outputName];
  const logits = logitsTensor.data as Float32Array;
  return topKSoftmax(logits, resources.classes, topK);
}

function topKSoftmax(
  logits: Float32Array,
  classes: string[],
  k: number,
): Candidate[] {
  // Softmax with the standard max-subtract trick for numerical stability.
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  const exps = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }

  // Partial-sort: track the top-K via a small heap-equivalent loop. K is
  // typically 8 — a linear scan with insertion into a sorted small array is
  // faster than a real heap here.
  const top: Candidate[] = [];
  for (let i = 0; i < exps.length; i++) {
    const score = exps[i] / sum;
    if (top.length < k) {
      top.push({ classIndex: i, char: classes[i] ?? "?", score });
      top.sort((a, b) => b.score - a.score);
    } else if (score > top[top.length - 1].score) {
      top[top.length - 1] = { classIndex: i, char: classes[i] ?? "?", score };
      // Re-sort the small array — O(k log k), negligible at k = 8.
      top.sort((a, b) => b.score - a.score);
    }
  }
  return top;
}
