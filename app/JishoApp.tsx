"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, type ScreenId } from "./components/AppShell";
import { ToastProvider } from "./components/Toast";
import { ReadScreen } from "./screens/ReadScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { FavoritesScreen } from "./screens/FavoritesScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EngineProvider } from "./providers/EngineProvider";
import { SettingsProvider } from "./providers/SettingsProvider";
import { UserDataProvider } from "./providers/UserDataProvider";
import { historyId } from "./lib/history";
import { readQueryParam } from "./lib/share";
import type { EngineResources } from "./lib/analyzer";

function AppRoot() {
  const [readText, setReadText] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<ScreenId>("read");
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // Seed the query from `?q=` on first mount. Initial state stays empty
  // so SSR-rendered HTML matches the first client render — no hydration
  // mismatch — and we pull the URL value in afterwards.
  useEffect(() => {
    const fromUrl = readQueryParam();
    if (!fromUrl) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is only readable on the client; doing this in a lazy useState initializer would cause a server/client hydration mismatch.
    setReadText(fromUrl);
    setActiveHistoryId(historyId(fromUrl));
  }, []);

  const openInRead = useCallback((text: string) => {
    setReadText(text);
    setActiveHistoryId(historyId(text));
    setScreen("read");
  }, []);

  return (
    <AppShell active={screen} onChange={setScreen}>
      {screen === "read" && (
        <ReadScreen key={readText ?? "__default__"} initialText={readText} />
      )}
      {screen === "history" && (
        <HistoryScreen activeId={activeHistoryId} onOpen={openInRead} />
      )}
      {screen === "favorites" && <FavoritesScreen />}
      {screen === "settings" && <SettingsScreen />}
    </AppShell>
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
