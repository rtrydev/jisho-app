import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "quiet" | "ghost" | "warn" | "icon";

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  quiet: "btn-quiet",
  ghost: "btn-ghost",
  warn: "btn-quiet btn-warn",
  icon: "ic-btn",
};

export function Button({
  variant = "quiet",
  leftIcon,
  rightIcon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}) {
  const cls = [variantClass[variant], className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
