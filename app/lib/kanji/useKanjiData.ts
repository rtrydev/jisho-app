"use client";

// React hook wrapper around loadKanjiData(). Lazy: only runs when the host
// component mounts (the RadicalPicker tab inside KanjiLookupSheet).

import { useEffect, useState } from "react";
import { loadKanjiData, type KanjiResources } from "./loader";
import type { KanjiDataStatus } from "./types";

export type KanjiData = {
  status: KanjiDataStatus;
  resources: KanjiResources | null;
};

export function useKanjiData(): KanjiData {
  const [status, setStatus] = useState<KanjiDataStatus>({
    kind: "loading",
    step: "Starting…",
    progress: 0,
  });
  const [resources, setResources] = useState<KanjiResources | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadKanjiData((step, ratio) => {
          if (cancelled) return;
          setStatus({
            kind: "loading",
            step,
            progress: Math.max(0, Math.min(1, ratio)),
          });
        });
        if (cancelled) return;
        setResources(loaded);
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

  return { status, resources };
}
