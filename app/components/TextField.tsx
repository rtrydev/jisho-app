import type { InputHTMLAttributes } from "react";

export function TextField({
  className,
  jp = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { jp?: boolean }) {
  const cls = ["text-field", jp ? "jp" : "", className].filter(Boolean).join(" ");
  return <input type="text" className={cls} {...rest} />;
}
