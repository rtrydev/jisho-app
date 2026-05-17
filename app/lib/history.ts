import type { StoreConfig } from "./storage";

export const HISTORY_CAP = 100;

export type HistoryEntry = {
  id: string;
  text: string;
  preview: string;
  termCount: number;
  createdAt: number;
  lastViewedAt: number;
};

export type HistoryState = {
  entries: HistoryEntry[];
};

export const emptyHistory = (): HistoryState => ({ entries: [] });

function normalize(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

/** Stable hash of the normalised input; same text → same id (dedupes whitespace). */
export function historyId(text: string): string {
  const norm = normalize(text);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < norm.length; i++) {
    h = (h ^ norm.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return "h_" + h.toString(36);
}

export function previewOf(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 24 ? cleaned.slice(0, 24) + "…" : cleaned;
}

/** Records a new analysis, or bumps an existing entry to the top. */
export function recordAnalysis(
  state: HistoryState,
  text: string,
  termCount: number,
  now: number = Date.now(),
): HistoryState {
  const trimmed = text.trim();
  if (!trimmed) return state;
  const id = historyId(trimmed);
  const existing = state.entries.find((e) => e.id === id);
  const next: HistoryEntry = existing
    ? { ...existing, lastViewedAt: now, termCount }
    : {
        id,
        text: trimmed,
        preview: previewOf(trimmed),
        termCount,
        createdAt: now,
        lastViewedAt: now,
      };
  const rest = state.entries.filter((e) => e.id !== id);
  const entries = [next, ...rest].slice(0, HISTORY_CAP);
  return { entries };
}

export function removeEntry(state: HistoryState, id: string): HistoryState {
  return { entries: state.entries.filter((e) => e.id !== id) };
}

export function clearAll(): HistoryState {
  return emptyHistory();
}

export function filterEntries(
  state: HistoryState,
  query: string,
): HistoryEntry[] {
  const q = query.trim();
  if (!q) return state.entries;
  const needle = q.toLowerCase();
  return state.entries.filter(
    (e) => e.text.toLowerCase().includes(needle) || e.preview.toLowerCase().includes(needle),
  );
}

export function relativeWhen(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return min + " min ago";
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + " hour" + (hr === 1 ? "" : "s") + " ago";
  const day = Math.round(hr / 24);
  if (day < 7) return day + " day" + (day === 1 ? "" : "s") + " ago";
  const date = new Date(ts);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function coerce(raw: unknown): HistoryState {
  if (!raw || typeof raw !== "object") return emptyHistory();
  const r = raw as { entries?: unknown };
  if (!Array.isArray(r.entries)) return emptyHistory();
  const entries: HistoryEntry[] = [];
  for (const e of r.entries) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      typeof o.text === "string" &&
      typeof o.termCount === "number" &&
      typeof o.createdAt === "number" &&
      typeof o.lastViewedAt === "number"
    ) {
      entries.push({
        id: o.id,
        text: o.text,
        preview: typeof o.preview === "string" ? o.preview : previewOf(o.text),
        termCount: o.termCount,
        createdAt: o.createdAt,
        lastViewedAt: o.lastViewedAt,
      });
    }
  }
  return { entries: entries.slice(0, HISTORY_CAP) };
}

export const historyStore: StoreConfig<HistoryState> = {
  key: "jp:v2:history",
  currentVersion: 1,
  defaults: emptyHistory,
  migrate: (_v, raw) => coerce(raw),
};
