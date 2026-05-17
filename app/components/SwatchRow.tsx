export type SwatchOption<T extends string> = {
  id: T;
  color: string;
  label: string;
};

export function SwatchRow<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<SwatchOption<T>>;
  onChange?: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="swatch-row" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={`swatch ${value === o.id ? "sw-on" : ""}`}
          onClick={() => onChange?.(o.id)}
        >
          <span className="sw-color" style={{ background: o.color }} />
          <span className="sw-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
