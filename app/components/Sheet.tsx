"use client";

import { useEffect, type ReactNode } from "react";
import * as Icon from "./Icon";

export function Sheet({
  children,
  className,
  onClose,
  ariaLabel,
  size = "full",
}: {
  children: ReactNode;
  className?: string;
  /** When provided, the sheet renders a close button in its header strip
   *  alongside the drag handle, and pressing Escape closes it. The button is
   *  part of the header row, so it never sits on top of children — earlier the
   *  close was floated with `position: absolute` and got covered by the card's
   *  `.float-actions` strip (same z-index, same top-right corner). */
  onClose?: () => void;
  /** Accessible name for the dialog. Set this whenever the sheet has no other
   *  programmatic label (the focus sheet borrows its term card's heading). */
  ariaLabel?: string;
  /** `full` (default) is the near-full-height focus sheet; `fit` sizes to its
   *  content (capped), for short panels like the install walkthrough. */
  size?: "full" | "fit";
}) {
  // Escape-to-close, gated on `onClose` and registered only while the sheet is
  // mounted (callers conditionally render it), so it costs nothing when closed.
  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={["sheet", size === "fit" && "sheet-fit", className]
        .filter(Boolean)
        .join(" ")}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="sheet-head">
        <div className="sheet-handle" aria-hidden />
        {onClose && (
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon.Close size={14} />
          </button>
        )}
      </div>
      <div className="sheet-body">{children}</div>
    </div>
  );
}
