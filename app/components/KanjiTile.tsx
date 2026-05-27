"use client";

// KanjiTile — single tappable kanji cell used in candidate ribbons.
//
// Two affordances:
//
//   * Primary tap → onClick → "insert this kanji". Always present.
//   * Corner info button → onInfo → "show kanji detail". Only renders when
//     the host provides an onInfo handler. The button stops event
//     propagation so tapping the corner doesn't also fire insert.

import type { MouseEvent } from "react";
import * as Icon from "./Icon";

export function KanjiTile({
  char,
  score,
  active = false,
  onClick,
  onInfo,
  ariaLabel,
}: {
  char: string;
  /** Softmax confidence in [0, 1]. Shown as a small numeric hint when present. */
  score?: number;
  active?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Optional info affordance. When provided, a small "i" button renders in
   *  the tile's top-right corner. Click is independent of the tile's main
   *  click — host typically opens a kanji detail view. */
  onInfo?: () => void;
  ariaLabel?: string;
}) {
  return (
    <div className={`kanji-tile-wrap${active ? " kanji-tile-active" : ""}`}>
      <button
        type="button"
        className="kanji-tile"
        onClick={onClick}
        aria-label={ariaLabel ?? `Insert ${char}`}
      >
        <span className="kanji-tile-glyph jp">{char}</span>
        {typeof score === "number" && (
          <span className="kanji-tile-score mono" aria-hidden>
            {(score * 100).toFixed(0)}
          </span>
        )}
      </button>
      {onInfo && (
        <button
          type="button"
          className="kanji-tile-info"
          onClick={(e) => {
            e.stopPropagation();
            onInfo();
          }}
          aria-label={`Show details for ${char}`}
        >
          <Icon.Info size={11} />
        </button>
      )}
    </div>
  );
}
