import type { ReactNode } from "react";

type TagTone = "default" | "jlpt" | "vocab" | "grammar";

const toneClass: Record<TagTone, string> = {
  default: "",
  jlpt: "tag-jlpt",
  vocab: "tag-vocab",
  grammar: "tag-grammar",
};

function inferTone(label: string): TagTone {
  if (/^(N[1-5]|JLPT)/.test(label)) return "jlpt";
  return "default";
}

export function Tag({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: TagTone;
  className?: string;
}) {
  const resolved =
    tone ?? (typeof children === "string" ? inferTone(children) : "default");
  const cls = ["tag", toneClass[resolved], className].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}

export function PosPill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={["pos-pill", className].filter(Boolean).join(" ")}>{children}</span>;
}
