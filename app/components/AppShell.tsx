"use client";

import { useEffect, useState, type ReactNode } from "react";
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

/** A small reactive bp hook for the responsive shell. */
export function useIsMobile(breakpoint: number = 820): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, [breakpoint]);
  return mobile;
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
  const mobile = useIsMobile();
  return (
    <div className={`app paper-tex ${mobile ? "mobile" : "desktop"}`}>
      {!mobile && <SideRail<ScreenId> items={RAIL_ITEMS} active={active} onChange={onChange} />}
      {mobile && (
        <header className="app-topbar" aria-label="App">
          <Hanko size="sm" />
          <div className="app-topbar-text">
            <span className="serif app-topbar-title">Jisho</span>
            <span className="mono app-topbar-sub">辞書</span>
          </div>
        </header>
      )}
      <main className="app-main" style={{ position: "relative", overflow: "hidden" }}>
        {children}
      </main>
      {mobile && <BottomTabs<ScreenId> items={TAB_ITEMS} active={active} onChange={onChange} />}
    </div>
  );
}
