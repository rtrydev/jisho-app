import type { ReactNode } from "react";
import * as Icon from "./Icon";

export function Sheet({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  /** When provided, the sheet renders a close button in its header strip
   *  alongside the drag handle. The button is part of the header row, so
   *  it never sits on top of children — earlier the close was floated
   *  with `position: absolute` and got covered by the card's
   *  `.float-actions` strip (same z-index, same top-right corner). */
  onClose?: () => void;
}) {
  return (
    <div
      className={["sheet", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-modal="true"
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
