import type { ButtonHTMLAttributes, ReactNode } from "react";

export function DataAction({
  label,
  description,
  tone = "quiet",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: ReactNode;
  description?: ReactNode;
  tone?: "quiet" | "warn";
}) {
  const cls = [
    "data-action",
    tone === "warn" ? "data-warn" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      <div className="da-label">{label}</div>
      {description && <div className="da-desc">{description}</div>}
    </button>
  );
}

export function DataActionGrid({ children }: { children: ReactNode }) {
  return <div className="set-data-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{children}</div>;
}
