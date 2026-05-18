"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TermCardData } from "../components/TermCard";
import {
  analyze,
  EMPTY_RESULT,
  getDictionaryEntry as resolveEntry,
  type AnalysisResult,
  type AnalysisStatus,
  type EngineResources,
} from "../lib/analyzer";

export type EngineContextValue = {
  status: AnalysisStatus;
  result: AnalysisResult;
  /** Analyse `text`. While the engine is loading this is a no-op; the latest
   *  request is queued and replayed once resources arrive. Returns the result
   *  if it can be computed synchronously, otherwise EMPTY_RESULT. */
  run: (text: string) => AnalysisResult;
  clear: () => void;
  /** Look up a stored favorite against the live dictionary. `surface` is an
   *  optional fallback key — used when the saved `dictKey` (e.g., a romaji
   *  stub key from an older build) doesn't resolve against the current
   *  resources. Returns null when the engine isn't ready yet, or when
   *  neither key is in the current resources. */
  getEntry: (
    type: "vocab" | "grammar",
    dictKey: string,
    surface?: string,
  ) => TermCardData | null;
};

const Ctx = createContext<EngineContextValue | null>(null);

export function EngineProvider({
  children,
  resources: injected,
}: {
  children: React.ReactNode;
  /** Inject pre-built resources to bypass the async loader — for tests and
   *  showcase fixtures. When omitted, the provider fetches the real assets on
   *  mount. */
  resources?: EngineResources;
}) {
  const [resources, setResources] = useState<EngineResources | null>(
    injected ?? null,
  );
  const [status, setStatus] = useState<AnalysisStatus>(() =>
    injected
      ? { kind: "idle" }
      : { kind: "loading", step: "Starting…", progress: 0 },
  );
  const [result, setResult] = useState<AnalysisResult>(EMPTY_RESULT);
  const pendingText = useRef<string | null>(null);

  // Kick off the async load when no resources were injected. Injected
  // resources are read once from the initial state — they aren't expected to
  // change across renders.
  useEffect(() => {
    if (injected) return;
    let cancelled = false;
    (async () => {
      try {
        const { loadEngineResources } = await import("../lib/engine/loader");
        const loaded = await loadEngineResources((step, ratio) => {
          if (cancelled) return;
          setStatus({
            kind: "loading",
            step,
            progress: Math.max(0, Math.min(1, ratio)),
          });
        });
        if (cancelled) return;
        setResources(loaded);
        setStatus({ kind: "idle" });
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
  }, [injected]);

  // When resources land, replay the most recent pending request.
  useEffect(() => {
    if (!resources) return;
    if (pendingText.current === null) return;
    const text = pendingText.current;
    pendingText.current = null;
    const next = analyze(resources, text);
    setResult(next);
    if (!text.trim()) setStatus({ kind: "idle" });
    else if (next.cardItems.length === 0) setStatus({ kind: "empty" });
    else setStatus({ kind: "ready" });
  }, [resources]);

  const run = useCallback(
    (text: string): AnalysisResult => {
      if (!resources) {
        pendingText.current = text;
        return EMPTY_RESULT;
      }
      const next = analyze(resources, text);
      setResult(next);
      if (!text.trim()) setStatus({ kind: "idle" });
      else if (next.cardItems.length === 0) setStatus({ kind: "empty" });
      else setStatus({ kind: "ready" });
      return next;
    },
    [resources],
  );

  const clear = useCallback(() => {
    pendingText.current = null;
    setResult(EMPTY_RESULT);
    setStatus(resources ? { kind: "idle" } : status);
  }, [resources, status]);

  const getEntry = useCallback(
    (type: "vocab" | "grammar", dictKey: string, surface?: string) => {
      if (!resources) return null;
      return resolveEntry(resources, type, dictKey, surface);
    },
    [resources],
  );

  const value = useMemo<EngineContextValue>(
    () => ({ status, result, run, clear, getEntry }),
    [status, result, run, clear, getEntry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalyzer(): EngineContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAnalyzer must be used inside <EngineProvider>");
  return v;
}
