import type { ReactNode } from "react";

export function SettingGroup({
  kanji,
  title,
  description,
  children,
  className,
}: {
  kanji?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["set-group", className].filter(Boolean).join(" ")}>
      <div className="set-group-head">
        {kanji && (
          <span className="set-group-kanji jp" aria-hidden>
            {kanji}
          </span>
        )}
        <div>
          <h2 className="serif">{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-row-l">
        <div className="set-row-label">{label}</div>
        {hint && <div className="set-row-hint">{hint}</div>}
      </div>
      <div className="set-row-r">{children}</div>
    </div>
  );
}
