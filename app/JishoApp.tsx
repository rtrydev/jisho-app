"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, type ScreenId } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";
import { ReadScreen, type ReadSeed } from "./screens/ReadScreen";
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
  // ReadScreen takes a "seed event" rather than a plain text value. Each
  // openInRead / URL-deep-link mints a fresh object so the screen re-syncs
  // even when the same text is opened twice — a bare string would trip
  // React's setState bailout on equality.
  const [readSeed, setReadSeed] = useState<ReadSeed | null>(null);
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
      setReadSeed({ text: q });
      setActiveHistoryId(historyId(q));
      if (!k) setScreen("read");
    }
    // URL is only readable on the client; doing this in a lazy useState
    // initializer would cause a server/client hydration mismatch.
  }, []);

  const openInRead = useCallback((text: string) => {
    setReadSeed({ text });
    setActiveHistoryId(historyId(text));
    setScreen("read");
  }, []);

  const openKanji = useCallback((char: string) => {
    setKanjiSeed(char);
    setScreen("kanji");
  }, []);

  const nav: Nav = { openInRead, openKanji };

  // Render every screen on every render and hide the inactive ones via
  // `display: none`. Conditional mounting would unmount the inactive screens
  // and discard their local state — the textarea contents on Read, the
  // selected input mode and in-progress strokes on Kanji, history/favorites
  // filters, etc. Keeping them mounted preserves all of it across tab
  // switches. `display: contents` makes the wrapper transparent to the
  // `.app-main` flex layout, so the active `.screen` still behaves as a
  // direct flex child.
  return (
    <NavContext.Provider value={nav}>
      <AppShell active={screen} onChange={setScreen}>
        <div style={{ display: screen === "read" ? "contents" : "none" }}>
          <ReadScreen seed={readSeed} />
        </div>
        <div style={{ display: screen === "kanji" ? "contents" : "none" }}>
          <KanjiScreen
            active={screen === "kanji"}
            initialChar={kanjiSeed}
            onClearInitial={() => setKanjiSeed(null)}
          />
        </div>
        <div style={{ display: screen === "history" ? "contents" : "none" }}>
          <HistoryScreen activeId={activeHistoryId} onOpen={openInRead} />
        </div>
        <div style={{ display: screen === "favorites" ? "contents" : "none" }}>
          <FavoritesScreen />
        </div>
        <div style={{ display: screen === "settings" ? "contents" : "none" }}>
          <SettingsScreen />
        </div>
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
