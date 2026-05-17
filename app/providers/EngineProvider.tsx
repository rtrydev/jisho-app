"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  analyze,
  isEngineReady,
  type AnalysisResult,
  type AnalysisStatus,
} from "../lib/analyzer";

export type EngineContextValue = {
  status: AnalysisStatus;
  result: AnalysisResult;
  /** Analyse `text` and update `result`. Returns the new result synchronously. */
  run: (text: string) => AnalysisResult;
  clear: () => void;
};

const Ctx = createContext<EngineContextValue | null>(null);

const EMPTY: AnalysisResult = { text: "", tokens: [], cardItems: [] };

function initialStatus(): AnalysisStatus {
  return isEngineReady() ? { kind: "ready" } : { kind: "loading", step: "warming engine" };
}

export function EngineProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AnalysisStatus>(initialStatus);
  const [result, setResult] = useState<AnalysisResult>(EMPTY);

  const run = useCallback((text: string): AnalysisResult => {
    const next = analyze(text);
    setResult(next);
    if (!text.trim()) {
      setStatus({ kind: "idle" });
    } else if (next.cardItems.length === 0) {
      setStatus({ kind: "empty" });
    } else {
      setStatus({ kind: "ready" });
    }
    return next;
  }, []);

  const clear = useCallback(() => {
    setResult(EMPTY);
    setStatus({ kind: "idle" });
  }, []);

  const value = useMemo<EngineContextValue>(
    () => ({ status, result, run, clear }),
    [status, result, run, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnalyzer(): EngineContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAnalyzer must be used inside <EngineProvider>");
  return v;
}
