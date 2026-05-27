"use client";

// React hook that wires the loader + inference utilities together.
//
// Loads lazily on first mount — the sheet that hosts the canvas is
// conditionally rendered, so this hook only runs once the user opens the
// handwriting picker. After that, the loaded session is cached for the rest
// of the session via the module-level promise in `loader.ts`.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadRecognizer, type RecognizerResources } from "./loader";
import { strokesToInput } from "./preprocess";
import { recognize } from "./recognize";
import type { Candidate, RecognizerStatus, Stroke } from "./types";

export type KanjiRecognizer = {
  status: RecognizerStatus;
  /** Returns top-K candidates for the current strokes. Resolves to an empty
   *  array when the strokes are empty. Throws only if recognition itself
   *  fails — load errors surface through `status` instead. */
  recognize: (strokes: Stroke[], topK?: number) => Promise<Candidate[]>;
};

export function useKanjiRecognizer(): KanjiRecognizer {
  const [status, setStatus] = useState<RecognizerStatus>({
    kind: "loading",
    step: "Starting…",
    progress: 0,
  });
  const resourcesRef = useRef<RecognizerResources | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resources = await loadRecognizer((step, ratio) => {
          if (cancelled) return;
          setStatus({
            kind: "loading",
            step,
            progress: Math.max(0, Math.min(1, ratio)),
          });
        });
        if (cancelled) return;
        resourcesRef.current = resources;
        setStatus({ kind: "ready" });
      } catch (err) {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (strokes: Stroke[], topK = 8): Promise<Candidate[]> => {
    const resources = resourcesRef.current;
    if (!resources) return [];
    const input = strokesToInput(strokes as Stroke[]);
    if (!input) return [];
    return recognize(resources, input, topK);
  }, []);

  return { status, recognize: run };
}
