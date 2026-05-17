import type { ReactNode } from "react";

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["eyebrow", className].filter(Boolean).join(" ")}>{children}</div>
  );
}

export function RuleGold({ className }: { className?: string }) {
  return <div className={["rule-gold", className].filter(Boolean).join(" ")} aria-hidden />;
}

export function Ornament({
  children = "❦",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["ornament", className].filter(Boolean).join(" ")} aria-hidden>
      {children}
    </div>
  );
}
