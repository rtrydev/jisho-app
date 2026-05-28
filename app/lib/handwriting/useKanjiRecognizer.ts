"use client";

// React hook that wires the loader + inference utilities together.
//
// Loads lazily on first mount — the sheet that hosts the canvas is
// conditionally rendered, so this hook only runs once the user opens the
// handwriting picker. After that, the loaded session is cached for the rest
// of the session via the module-level promise in `loader.ts`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadRecognizer, type RecognizerResources } from "./loader";
import { recognizeMulti } from "./recognizeMulti";
import type { Candidate, RecognizerStatus, Stroke } from "./types";

export type KanjiRecognizer = {
  status: RecognizerStatus;
  /** Segments the strokes into characters left-to-right and returns top-K
   *  candidates *per detected character*. Resolves to an empty array when
   *  the strokes are empty. Throws only if recognition itself fails — load
   *  errors surface through `status` instead. */
  recognize: (strokes: Stroke[], topK?: number) => Promise<Candidate[][]>;
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

  const run = useCallback(async (strokes: Stroke[], topK = 8): Promise<Candidate[][]> => {
    const resources = resourcesRef.current;
    if (!resources) return [];
    return recognizeMulti(strokes, resources, topK);
  }, []);

  // Memoize the returned shape so consumers can put `recognizer` straight in
  // a useEffect dep array without retriggering on every render. Without
  // this the returned object literal is a fresh reference each render,
  // which previously caused an infinite recognize/setState loop in callers
  // that depended on the whole recognizer.
  return useMemo(
    () => ({ status, recognize: run }),
    [status, run],
  );
}
