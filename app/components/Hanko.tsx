type Size = "mini" | "sm" | "md" | "lg";

const sizeClass: Record<Size, string> = {
  mini: "hanko-mini",
  sm: "hanko hanko-sm",
  md: "hanko",
  lg: "hanko hanko-lg",
};

export function Hanko({
  size = "md",
  children = "辞書",
  className,
  style,
  "aria-label": ariaLabel,
}: {
  size?: Size;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  const cls = [sizeClass[size], className].filter(Boolean).join(" ");
  return (
    <span className={cls} style={style} aria-label={ariaLabel} aria-hidden={!ariaLabel}>
      {children}
    </span>
  );
}
