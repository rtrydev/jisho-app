"use client";

import { useCallback, useState } from "react";
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
import { clearFragment, readFragmentQuery } from "./lib/share";
import type { EngineResources } from "./lib/analyzer";

/** Read + consume any `#q1:…` deep link exactly once, synchronously. */
function consumeFragmentQueryOnce(): string | null {
  if (typeof window === "undefined") return null;
  const fromFragment = readFragmentQuery();
  if (fromFragment) clearFragment();
  return fromFragment;
}

function AppRoot() {
  const [readText, setReadText] = useState<string | undefined>(() => {
    const fromFragment = consumeFragmentQueryOnce();
    return fromFragment ?? undefined;
  });
  const [screen, setScreen] = useState<ScreenId>("read");
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(() =>
    readText ? historyId(readText) : null,
  );

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
