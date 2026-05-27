import type { ReactNode } from "react";
import { Hanko } from "./Hanko";

export type RailItem<T extends string> = {
  id: T;
  label: string;
  kanji: string;
};

export function SideRail<T extends string>({
  active,
  items,
  onChange,
  brand = "Jisho",
  subtitle = "辞書",
  marginalia = "和 ・ 訳 ・ 英",
}: {
  active: T;
  items: ReadonlyArray<RailItem<T>>;
  onChange?: (id: T) => void;
  brand?: ReactNode;
  subtitle?: ReactNode;
  marginalia?: ReactNode;
}) {
  return (
    <nav className="rail" aria-label="Primary">
      {/* Plain <a> on purpose: clicking the brand should hard-reload to
          drop in-memory state. `next/link` would client-side-route and
          keep state, which is the opposite of the intent. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" onClick={(e) => { e.preventDefault(); window.location.href = "/"; }} className="rail-brand">
        <Hanko />
        <div className="rail-brand-text">
          <div className="serif rail-title">{brand}</div>
          <div className="rail-sub mono">{subtitle}</div>
        </div>
      </a>
      <ul className="rail-list">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              className={`rail-item ${active === it.id ? "rail-active" : ""}`}
              aria-current={active === it.id ? "page" : undefined}
              onClick={() => onChange?.(it.id)}
            >
              <span className="rail-kanji jp">{it.kanji}</span>
              <span className="rail-label">{it.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {marginalia && (
        <div className="rail-foot">
          <div className="tategaki ink-faint" style={{ fontSize: 10, lineHeight: 1.8 }}>
            {marginalia}
          </div>
        </div>
      )}
    </nav>
  );
}
