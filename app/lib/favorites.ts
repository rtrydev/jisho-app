import type { StoreConfig } from "./storage";

export type FavoriteType = "vocab" | "grammar";

export type FavoriteEntry = {
  id: string;          // "type:dictKey"
  type: FavoriteType;
  dictKey: string;
  surface: string;
  addedAt: number;
  // Reserved space for future review metadata (SRS, etc.) — not populated in v2.
  reviewMeta?: Record<string, unknown>;
};

export type FavoritesState = {
  entries: FavoriteEntry[];
};

export const emptyFavorites = (): FavoritesState => ({ entries: [] });

export function favoriteId(type: FavoriteType, dictKey: string): string {
  return type + ":" + dictKey;
}

export function hasFavorite(state: FavoritesState, id: string): boolean {
  return state.entries.some((e) => e.id === id);
}

export function addFavorite(
  state: FavoritesState,
  type: FavoriteType,
  dictKey: string,
  surface: string,
  now: number = Date.now(),
): FavoritesState {
  const id = favoriteId(type, dictKey);
  if (hasFavorite(state, id)) return state;
  const entry: FavoriteEntry = { id, type, dictKey, surface, addedAt: now };
  return { entries: [entry, ...state.entries] };
}

export function removeFavorite(state: FavoritesState, id: string): FavoritesState {
  return { entries: state.entries.filter((e) => e.id !== id) };
}

export function toggleFavorite(
  state: FavoritesState,
  type: FavoriteType,
  dictKey: string,
  surface: string,
): FavoritesState {
  const id = favoriteId(type, dictKey);
  return hasFavorite(state, id)
    ? removeFavorite(state, id)
    : addFavorite(state, type, dictKey, surface);
}

function coerce(raw: unknown): FavoritesState {
  if (!raw || typeof raw !== "object") return emptyFavorites();
  const r = raw as { entries?: unknown };
  if (!Array.isArray(r.entries)) return emptyFavorites();
  const out: FavoriteEntry[] = [];
  for (const e of r.entries) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      (o.type === "vocab" || o.type === "grammar") &&
      typeof o.dictKey === "string" &&
      typeof o.surface === "string" &&
      typeof o.addedAt === "number"
    ) {
      out.push({
        id: o.id,
        type: o.type,
        dictKey: o.dictKey,
        surface: o.surface,
        addedAt: o.addedAt,
        reviewMeta:
          o.reviewMeta && typeof o.reviewMeta === "object"
            ? (o.reviewMeta as Record<string, unknown>)
            : undefined,
      });
    }
  }
  return { entries: out };
}

export const favoritesStore: StoreConfig<FavoritesState> = {
  key: "jp:v2:favorites",
  currentVersion: 1,
  defaults: emptyFavorites,
  migrate: (_v, raw) => coerce(raw),
};

export function exportMarkdown(state: FavoritesState): string {
  const lines = ["# Jisho favorites", "", `_Exported ${new Date().toISOString()}_`, ""];
  const vocab = state.entries.filter((e) => e.type === "vocab");
  const grammar = state.entries.filter((e) => e.type === "grammar");
  if (vocab.length) {
    lines.push("## Vocabulary", "");
    for (const e of vocab) lines.push(`- ${e.surface}  ·  \`${e.dictKey}\``);
    lines.push("");
  }
  if (grammar.length) {
    lines.push("## Grammar", "");
    for (const e of grammar) lines.push(`- ${e.surface}  ·  \`${e.dictKey}\``);
    lines.push("");
  }
  return lines.join("\n");
}

export function exportJson(state: FavoritesState): string {
  return JSON.stringify({ schemaVersion: 1, entries: state.entries }, null, 2);
}

export function importJson(raw: string): FavoritesState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    return coerce({ entries: p.entries });
  } catch {
    return null;
  }
}
