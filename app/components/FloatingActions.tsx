"use client";

import { useState, type CSSProperties } from "react";
import * as Icon from "./Icon";

export function FloatingActions({
  favorite,
  onFavorite,
  onCopy,
  onShare,
  style,
}: {
  favorite?: boolean;
  onFavorite?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  style?: CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    setCopied(true);
    onCopy?.();
    setTimeout(() => setCopied(false), 1100);
  };
  const favLabel = favorite ? "Remove favorite" : "Add favorite";
  // A button renders when the consumer either provides a click handler OR,
  // for favorite, signals a current state via `favorite={true|false}`.
  // EN→JP inverted cards intentionally pass all three as undefined to hide
  // the strip — the card represents an aggregate English query rather than
  // a single JP entry, and the favorites schema is JP-keyed.
  const showFavorite = onFavorite !== undefined || favorite !== undefined;
  const showCopy = onCopy !== undefined;
  const showShare = onShare !== undefined;
  return (
    <div className="float-actions" style={style}>
      {showFavorite && (
        <button
          type="button"
          className={`fa-btn fav ${favorite ? "on" : ""}`}
          aria-label={favLabel}
          aria-pressed={favorite ?? false}
          data-tooltip={favLabel}
          onClick={onFavorite}
        >
          <Icon.Heart filled={favorite} size={14} />
        </button>
      )}
      {showCopy && (
        <button
          type="button"
          className="fa-btn"
          aria-label="Copy term"
          data-tooltip="Copy term"
          onClick={handleCopy}
        >
          {copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
        </button>
      )}
      {showShare && (
        <button
          type="button"
          className="fa-btn"
          aria-label="Copy share link"
          data-tooltip="Copy share link"
          onClick={onShare}
        >
          <Icon.ShareArrow size={14} />
        </button>
      )}
    </div>
  );
}
