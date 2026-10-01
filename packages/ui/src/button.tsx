import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  default: "border-border-strong bg-surface-2 text-text-primary hover:bg-[#222]",
  primary: "border-text-primary bg-text-primary text-bg hover:bg-[#d9d9d9]",
  danger: "border-negative/60 bg-transparent text-negative hover:bg-negative/10",
  ghost: "border-transparent bg-transparent text-text-secondary hover:text-text-primary",
};

export function Button({
  variant = "default",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-panel)] border px-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
