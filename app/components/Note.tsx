import type { ReactNode } from "react";

export function Note({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={["note", className].filter(Boolean).join(" ")}>{children}</p>;
}
