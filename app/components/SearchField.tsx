import type { InputHTMLAttributes } from "react";
import * as Icon from "./Icon";

export function SearchField({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const cls = ["search-field", className].filter(Boolean).join(" ");
  return (
    <label className={cls}>
      <Icon.Search size={14} />
      <input type="text" {...rest} />
    </label>
  );
}
