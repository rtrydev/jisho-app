"use client";

// React hook over the recognizer channel.
//
// Loads lazily on first mount — the Kanji screen's Draw panel is the only
// consumer, so the worker (and the model download) only spins up once the user
// opens it. The channel is a session-level singleton (see recognizerChannel.ts),
// so the loaded session survives canvas mount/unmount and inference runs off
// the main thread.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getRecognizerChannel } from "./recognizerChannel";
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

  useEffect(() => {
    let cancelled = false;
    const channel = getRecognizerChannel();
    channel
      .load((step, ratio) => {
        if (cancelled) return;
        setStatus({
          kind: "loading",
          step,
          progress: Math.max(0, Math.min(1, ratio)),
        });
      })
      .then(() => {
        if (!cancelled) setStatus({ kind: "ready" });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    async (strokes: Stroke[], topK = 8): Promise<Candidate[][]> =>
      getRecognizerChannel().recognize(strokes, topK),
    [],
  );

  // Memoize the returned shape so consumers can put `recognizer` straight in
  // a useEffect dep array without retriggering on every render. Without
  // this the returned object literal is a fresh reference each render,
  // which previously caused an infinite recognize/setState loop in callers
  // that depended on the whole recognizer.
  return useMemo(() => ({ status, recognize: run }), [status, run]);
}
