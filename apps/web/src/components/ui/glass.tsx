import type { ElementType, ReactNode } from "react";

type Glow = "none" | "cyan" | "violet";

interface GlassPanelProps {
  children: ReactNode;
  className?: string;
  /** Selected/active panels get a thin luminous border. */
  glow?: Glow;
  /** Flatter, quieter surface for dense content such as code, debates and tables. */
  quiet?: boolean;
  as?: ElementType;
  "aria-label"?: string;
}

const GLOW: Record<Glow, string> = { none: "", cyan: "neon-ring", violet: "neon-ring-violet" };

/** Frosted glass surface – the base container of the Consyrion design system. */
export function GlassPanel({ children, className = "", glow = "none", quiet = false, as: Tag = "section", ...rest }: GlassPanelProps) {
  return (
    <Tag className={`${quiet ? "glass-quiet" : "glass"} rounded-2xl ${GLOW[glow]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Gradient hairline around its content (cyan → emerald → violet). Used sparingly for hero elements and
 * primary calls to action; the inner surface keeps the normal text contrast.
 */
export function NeonBorder({ children, className = "", innerClassName = "" }: { children: ReactNode; className?: string; innerClassName?: string }) {
  return (
    <div className={`rounded-2xl bg-[linear-gradient(120deg,var(--primary),var(--success)_45%,var(--accent))] p-px ${className}`}>
      <div className={`h-full rounded-[15px] bg-[color-mix(in_oklab,var(--bg)_94%,var(--primary))] ${innerClassName}`}>{children}</div>
    </div>
  );
}
