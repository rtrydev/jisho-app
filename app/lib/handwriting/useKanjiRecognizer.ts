"use client";

// React hook that wires the recognizer client to the Draw screen.
//
// Loads lazily on first mount — the Kanji screen's Draw panel is the only
// consumer, so this hook only runs once the user opens it. Inference runs off
// the main thread in a dedicated worker (recognizerClient → recognizer.worker),
// so `recognize` stays non-blocking; on environments without Worker/
// OffscreenCanvas the client falls back to main-thread inference transparently.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRecognizerClient,
  type RecognizerClient,
} from "./recognizerClient";
import type { Candidate, RecognizerStatus, Stroke } from "./types";

export type KanjiRecognizer = {
  status: RecognizerStatus;
  /** Segments the strokes into characters left-to-right and returns top-K
   *  candidates *per detected character*. Resolves to an empty array when
   *  the strokes are empty. Throws only if recognition itself fails — load
   *  errors surface through `status` instead. */
  recognize: (strokes: Stroke[], topK?: number) => Promise<Candidate[][]>;
  /** Recognize already-segmented, already-normalized 96×96 cells (the camera
   *  path — see imagePreprocess.ts). Returns top-K per cell, in order. */
  recognizeImage: (
    cells: Float32Array[],
    topK?: number,
  ) => Promise<Candidate[][]>;
};

export function useKanjiRecognizer(): KanjiRecognizer {
  const [status, setStatus] = useState<RecognizerStatus>({
    kind: "loading",
    step: "Starting…",
    progress: 0,
  });
  const clientRef = useRef<RecognizerClient | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { ready, client } = createRecognizerClient((step, ratio) => {
      if (cancelled) return;
      setStatus({
        kind: "loading",
        step,
        progress: Math.max(0, Math.min(1, ratio)),
      });
    });
    clientRef.current = client;
    ready.then(
      () => {
        if (!cancelled) setStatus({ kind: "ready" });
      },
      (err: unknown) => {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const run = useCallback(
    async (strokes: Stroke[], topK = 8): Promise<Candidate[][]> => {
      const client = clientRef.current;
      if (!client) return [];
      return client.recognize(strokes, topK);
    },
    [],
  );

  const runImage = useCallback(
    async (cells: Float32Array[], topK = 8): Promise<Candidate[][]> => {
      const client = clientRef.current;
      if (!client || cells.length === 0) return [];
      return client.recognizeImage(cells, topK);
    },
    [],
  );

  // Memoize the returned shape so consumers can put `recognizer` straight in
  // a useEffect dep array without retriggering on every render. Without
  // this the returned object literal is a fresh reference each render,
  // which previously caused an infinite recognize/setState loop in callers
  // that depended on the whole recognizer.
  return useMemo(
    () => ({ status, recognize: run, recognizeImage: runImage }),
    [status, run, runImage],
  );
}
