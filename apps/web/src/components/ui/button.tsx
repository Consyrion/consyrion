import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-text shadow-[0_0_24px_-8px_var(--glow-cyan)] hover:bg-primary-strong",
  secondary: "border border-glass-line bg-surface-2/70 text-text hover:border-primary",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "border border-danger/50 text-danger hover:bg-danger/10",
};

export function buttonClasses(variant: Variant = "primary", extra = "") {
  return `inline-flex items-center justify-center gap-2 min-h-10 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={buttonClasses(variant, className)} {...props} />;
}
