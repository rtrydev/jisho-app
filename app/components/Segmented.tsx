import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label?: ReactNode;
};

type Variant = "inline" | "card";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  variant = "inline",
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<T | SegmentedOption<T>>;
  onChange?: (next: T) => void;
  variant?: Variant;
  ariaLabel?: string;
}) {
  const opts: SegmentedOption<T>[] = options.map((o) =>
    typeof o === "string" ? { value: o as T } : o
  );
  return (
    <div className={variant === "card" ? "fav-segs" : "seg"} role="radiogroup" aria-label={ariaLabel}>
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`seg-btn ${value === o.value ? "seg-on" : ""}`}
          onClick={() => onChange?.(o.value)}
        >
          {o.label ?? o.value}
        </button>
      ))}
    </div>
  );
}
