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
  clearStore,
  getStorageStatus,
  onStorageStatusChange,
  type StorageStatus,
} from "../lib/storage";
import { ReactiveStore, useReactiveStore } from "../lib/reactiveStore";
import {
  emptyFavorites,
  favoriteId,
  favoritesStore as favoritesStoreCfg,
  hasFavorite,
  toggleFavorite as toggleFavoriteOp,
  type FavoritesState,
  type FavoriteType,
} from "../lib/favorites";
import {
  clearAll,
  emptyHistory,
  historyStore as historyStoreCfg,
  recordAnalysis,
  removeEntry,
  type HistoryState,
} from "../lib/history";

const historyStore = new ReactiveStore<HistoryState>(historyStoreCfg);
const favoritesStore = new ReactiveStore<FavoritesState>(favoritesStoreCfg);

type UserDataContextValue = {
  storageStatus: { status: StorageStatus; reason?: string };

  history: HistoryState;
  recordHistory: (text: string, termCount: number) => void;
  deleteHistoryEntry: (id: string) => void;
  clearHistory: () => void;

  favorites: FavoritesState;
  isFavorite: (type: FavoriteType, dictKey: string) => boolean;
  toggleFavorite: (type: FavoriteType, dictKey: string, surface: string) => void;
  importFavorites: (state: FavoritesState) => void;
  clearFavorites: () => void;

  clearAllData: () => void;
};

const Ctx = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const history = useReactiveStore(historyStore);
  const favorites = useReactiveStore(favoritesStore);
  const [storageStatus, setStorageStatus] = useState(() => getStorageStatus());

  useEffect(() => {
    return onStorageStatusChange((status, reason) =>
      setStorageStatus({ status, reason }),
    );
  }, []);

  const recordHistory = useCallback((text: string, termCount: number) => {
    historyStore.set((prev) => recordAnalysis(prev, text, termCount));
  }, []);

  const deleteHistoryEntry = useCallback((id: string) => {
    historyStore.set((prev) => removeEntry(prev, id));
  }, []);

  const clearHistory = useCallback(() => {
    historyStore.set(clearAll());
  }, []);

  const isFavorite = useCallback(
    (type: FavoriteType, dictKey: string) =>
      hasFavorite(favorites, favoriteId(type, dictKey)),
    [favorites],
  );

  const toggleFavorite = useCallback(
    (type: FavoriteType, dictKey: string, surface: string) => {
      favoritesStore.set((prev) => toggleFavoriteOp(prev, type, dictKey, surface));
    },
    [],
  );

  const importFavorites = useCallback((incoming: FavoritesState) => {
    favoritesStore.set((prev) => {
      const seen = new Set(prev.entries.map((e) => e.id));
      return {
        entries: [
          ...prev.entries,
          ...incoming.entries.filter((e) => !seen.has(e.id)),
        ],
      };
    });
  }, []);

  const clearFavorites = useCallback(() => {
    favoritesStore.set(emptyFavorites());
  }, []);

  const clearAllData = useCallback(() => {
    historyStore.set(emptyHistory());
    favoritesStore.set(emptyFavorites());
    clearStore(historyStoreCfg);
    clearStore(favoritesStoreCfg);
  }, []);

  const value = useMemo<UserDataContextValue>(
    () => ({
      storageStatus,
      history,
      recordHistory,
      deleteHistoryEntry,
      clearHistory,
      favorites,
      isFavorite,
      toggleFavorite,
      importFavorites,
      clearFavorites,
      clearAllData,
    }),
    [
      storageStatus,
      history,
      recordHistory,
      deleteHistoryEntry,
      clearHistory,
      favorites,
      isFavorite,
      toggleFavorite,
      importFavorites,
      clearFavorites,
      clearAllData,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserData(): UserDataContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUserData must be used inside <UserDataProvider>");
  return v;
}
