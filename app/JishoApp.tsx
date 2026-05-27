"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, type ScreenId } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";
import { ReadScreen } from "./screens/ReadScreen";
import { KanjiScreen } from "./screens/KanjiScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { FavoritesScreen } from "./screens/FavoritesScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EngineProvider } from "./providers/EngineProvider";
import { SettingsProvider } from "./providers/SettingsProvider";
import { UserDataProvider } from "./providers/UserDataProvider";
import { historyId } from "./lib/history";
import { readKanjiParam, readQueryParam } from "./lib/share";
import type { EngineResources } from "./lib/analyzer";

/** Cross-screen navigation actions. The Kanji-breakdown rows on Read's
 *  TermCard call `openKanji(char)` to jump straight to the Kanji screen
 *  with that character seeded. */
type Nav = {
  openInRead: (text: string) => void;
  openKanji: (char: string) => void;
};

const NAV_NOOP: Nav = {
  openInRead: () => {},
  openKanji: () => {},
};

import { createContext, useContext } from "react";
const NavContext = createContext<Nav>(NAV_NOOP);
export function useNav(): Nav {
  return useContext(NavContext);
}

function AppRoot() {
  const [readText, setReadText] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<ScreenId>("read");
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [kanjiSeed, setKanjiSeed] = useState<string | null>(null);

  // Seed from URL on first mount. ?kanji= wins over ?q= for screen selection
  // (you'd put both on a deep-link, the kanji one is more specific). Both
  // values are still stashed so switching screens later shows what you'd
  // expect. Initial state stays empty so SSR-rendered HTML matches the first
  // client render — we pull the URL value in afterwards.
  useEffect(() => {
    const k = readKanjiParam();
    const q = readQueryParam();
    if (k) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setKanjiSeed(k);
      setScreen("kanji");
    }
    if (q) {
      setReadText(q);
      setActiveHistoryId(historyId(q));
      if (!k) setScreen("read");
    }
    // URL is only readable on the client; doing this in a lazy useState
    // initializer would cause a server/client hydration mismatch.
  }, []);

  const openInRead = useCallback((text: string) => {
    setReadText(text);
    setActiveHistoryId(historyId(text));
    setScreen("read");
  }, []);

  const openKanji = useCallback((char: string) => {
    setKanjiSeed(char);
    setScreen("kanji");
  }, []);

  const nav: Nav = { openInRead, openKanji };

  return (
    <NavContext.Provider value={nav}>
      <AppShell active={screen} onChange={setScreen}>
        {screen === "read" && (
          <ReadScreen key={readText ?? "__default__"} initialText={readText} />
        )}
        {screen === "kanji" && (
          <KanjiScreen
            initialChar={kanjiSeed}
            onClearInitial={() => setKanjiSeed(null)}
          />
        )}
        {screen === "history" && (
          <HistoryScreen activeId={activeHistoryId} onOpen={openInRead} />
        )}
        {screen === "favorites" && <FavoritesScreen />}
        {screen === "settings" && <SettingsScreen />}
      </AppShell>
    </NavContext.Provider>
  );
}

export function JishoApp({
  engineResources,
}: {
  engineResources?: EngineResources;
} = {}) {
  return (
    <SettingsProvider>
      <UserDataProvider>
        <EngineProvider resources={engineResources}>
          <ToastProvider>
            <AppRoot />
          </ToastProvider>
        </EngineProvider>
      </UserDataProvider>
    </SettingsProvider>
  );
}
