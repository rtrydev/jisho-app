"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import * as Icon from "./Icon";
import { Hanko } from "./Hanko";
import { SideRail, type RailItem } from "./SideRail";
import { BottomTabs, type TabItem } from "./BottomTabs";

export type ScreenId = "read" | "history" | "favorites" | "settings";

const RAIL_ITEMS: RailItem<ScreenId>[] = [
  { id: "read", label: "Read", kanji: "読" },
  { id: "history", label: "History", kanji: "歴" },
  { id: "favorites", label: "Favorites", kanji: "印" },
  { id: "settings", label: "Settings", kanji: "設" },
];

const TAB_ITEMS: TabItem<ScreenId>[] = [
  { id: "read", label: "Read", icon: Icon.Read },
  { id: "history", label: "History", icon: Icon.History },
  { id: "favorites", label: "Favorites", icon: Icon.Favorites },
  { id: "settings", label: "Settings", icon: Icon.Settings },
];

const MOBILE_BREAKPOINT_PX = 820;

/** Reactive breakpoint hook. Seeds from `<html data-platform>` (written by the
 *  pre-hydration script in `app/layout.tsx`) so the very first render already
 *  knows whether we're on mobile — no JS-driven re-layout flicker after
 *  hydration. */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT_PX): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
      mq.addEventListener?.("change", cb);
      return () => mq.removeEventListener?.("change", cb);
    },
    () => {
      if (typeof window === "undefined") return false;
      return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
    },
    // Server snapshot: read from <html data-platform> if available (only on
    // the *client*, during hydration). Server-render returns `false`
    // unconditionally — the pre-hydration script writes `data-platform`
    // before paint, and the client snapshot above takes over after mount.
    () => {
      if (typeof document === "undefined") return false;
      return document.documentElement.dataset.platform === "mobile";
    },
  );
}

export function AppShell({
  active,
  onChange,
  children,
}: {
  active: ScreenId;
  onChange: (id: ScreenId) => void;
  children: ReactNode;
}) {
  // The shell layout is fully CSS-driven via @media queries on `.app`,
  // `.app-topbar`, `.rail`, and `.btab`. Render every nav variant on every
  // viewport; the stylesheet hides what doesn't belong. This is what removes
  // the "desktop chrome flashes before mobile chrome takes over" jank — there
  // is no JS branch deciding which nav to mount.
  return (
    <div className="app paper-tex">
      <SideRail<ScreenId> items={RAIL_ITEMS} active={active} onChange={onChange} />
      <header className="app-topbar" aria-label="App">
        <Hanko size="md" />
        <div className="app-topbar-text">
          <span className="serif app-topbar-title">Jisho</span>
          <span className="mono app-topbar-sub">辞書</span>
        </div>
        <span className="jp app-topbar-marginalia" aria-hidden="true">
          客 ・ 静 ・ 読
        </span>
      </header>
      <main className="app-main">{children}</main>
      <BottomTabs<ScreenId> items={TAB_ITEMS} active={active} onChange={onChange} />
    </div>
  );
}

