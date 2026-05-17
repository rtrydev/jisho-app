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
  return (
    <div className="float-actions" style={style}>
      <button
        type="button"
        className={`fa-btn fav ${favorite ? "on" : ""}`}
        aria-label={favorite ? "Remove favorite" : "Add favorite"}
        aria-pressed={favorite ?? false}
        onClick={onFavorite}
      >
        <Icon.Seal filled={favorite} size={14} />
      </button>
      <button
        type="button"
        className="fa-btn"
        aria-label="Copy card"
        onClick={handleCopy}
      >
        {copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
      </button>
      <button
        type="button"
        className="fa-btn"
        aria-label="Share term"
        onClick={onShare}
      >
        <Icon.ShareArrow size={14} />
      </button>
    </div>
  );
}
