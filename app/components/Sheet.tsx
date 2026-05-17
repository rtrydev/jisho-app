import type { ReactNode } from "react";

export function Sheet({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["sheet", className].filter(Boolean).join(" ")} role="dialog" aria-modal="true">
      <div className="sheet-handle" aria-hidden />
      {children}
    </div>
  );
}
