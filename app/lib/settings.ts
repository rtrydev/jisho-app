import type { StoreConfig } from "./storage";

export type Theme = "light" | "dark" | "sepia" | "system";
export type Accent = "seal" | "indigo" | "sumi";
export type FuriganaMode = "always" | "hover" | "off";
export type JpScale = "S" | "M" | "L";
export type CopyFormat = "markdown" | "plain";

export type Settings = {
  theme: Theme;
  accent: Accent;
  furiganaMode: FuriganaMode;
  japaneseFontScale: JpScale;
  defaultSentence: string;
  copyFormat: CopyFormat;
};

export const DEFAULT_SENTENCE = "私はその人を常に先生と呼んでいた。";

export const defaultSettings = (): Settings => ({
  theme: "system",
  accent: "seal",
  furiganaMode: "always",
  japaneseFontScale: "M",
  defaultSentence: DEFAULT_SENTENCE,
  copyFormat: "markdown",
});

const ALLOWED: {
  [K in keyof Settings]: ReadonlyArray<Settings[K]> | null;
} = {
  theme: ["light", "dark", "sepia", "system"],
  accent: ["seal", "indigo", "sumi"],
  furiganaMode: ["always", "hover", "off"],
  japaneseFontScale: ["S", "M", "L"],
  defaultSentence: null,
  copyFormat: ["markdown", "plain"],
};

function coerce(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof Settings)[]) {
    const v = r[k];
    const allowed = ALLOWED[k];
    if (allowed === null) {
      if (typeof v === "string") {
        (base[k] as string) = v;
      }
    } else if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (base[k] as any) = v;
    }
  }
  return base;
}

export const settingsStore: StoreConfig<Settings> = {
  key: "jp:v2:settings",
  currentVersion: 1,
  defaults: defaultSettings,
  migrate: (_v, raw) => coerce(raw),
};

/** Theme tokens flow strictly one way: settings → root data-attrs → tokens. */
export function applySettingsToRoot(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolvedTheme = s.theme === "system" ? resolveSystemTheme() : s.theme;
  root.dataset.theme = resolvedTheme;
  root.dataset.accent = s.accent;
  root.dataset.furigana = s.furiganaMode;
  root.dataset.jpScale = s.japaneseFontScale;
}

export function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  return mq?.matches ? "dark" : "light";
}
