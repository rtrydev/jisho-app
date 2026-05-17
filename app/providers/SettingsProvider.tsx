"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applySettingsToRoot,
  defaultSettings,
  resolveSystemTheme,
  settingsStore as settingsStoreCfg,
  type Settings,
} from "../lib/settings";
import { ReactiveStore, useReactiveStore } from "../lib/reactiveStore";

// Module-level store. Hydrates on first subscribe (client only) and
// persists every write to localStorage. Survives Fast Refresh.
const settingsStore = new ReactiveStore<Settings>(settingsStoreCfg);

type SettingsContextValue = {
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
};

const Ctx = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const settings = useReactiveStore(settingsStore);

  // Mirror to <html data-*>. Runs after each render; cheap idempotent writes.
  useEffect(() => {
    applySettingsToRoot(settings);
  }, [settings]);

  // Re-resolve when the OS theme flips while we're on "system".
  useEffect(() => {
    if (settings.theme !== "system") return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applySettingsToRoot(settings);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [settings]);

  const setSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      settingsStore.set((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    settingsStore.set(defaultSettings());
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, setSetting, reset }),
    [settings, setSetting, reset],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings must be used inside <SettingsProvider>");
  return v;
}

/** The *effective* theme — "system" resolved to light/dark. */
export function useEffectiveTheme(): "light" | "dark" | "sepia" {
  const { settings } = useSettings();
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveSystemTheme());
  useEffect(() => {
    if (settings.theme !== "system") return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setResolved(mq.matches ? "dark" : "light");
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, [settings.theme]);
  if (settings.theme === "system") return resolved;
  return settings.theme;
}
