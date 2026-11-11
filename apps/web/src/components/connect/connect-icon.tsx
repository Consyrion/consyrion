import type { ConnectIcon as IconName } from "@/lib/connect-catalog";

// Simple line glyphs (own drawings, no third-party logos) so the grid stays neutral and works in both themes.
const PATHS: Record<IconName, string> = {
  terminal: "M4 6l5 5-5 5M11 17h8",
  cursor: "M5 4l13 6-6 2-2 6z",
  code: "M9 7l-5 5 5 5M15 7l5 5-5 5",
  desktop: "M3 5h18v11H3zM8 20h8M12 16v4",
  puzzle: "M10 4h4v3a2 2 0 104 0V4h2v6h-3a2 2 0 100 4h3v6h-6v-3a2 2 0 10-4 0v3H4v-6h3a2 2 0 100-4H4V4z",
  telegram: "M21 4L3 11l6 2 2 6 3-4 4 3z M9 13l9-7",
  github: "M6 3v12M18 9v12M6 15a6 6 0 006-6h6M6 21a2 2 0 100-4 2 2 0 000 4z",
  mail: "M3 6h18v12H3zM3 6l9 7 9-7",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  chat: "M4 5h16v10H9l-5 4z",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h4",
};

export function ConnectIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-glass-line bg-surface-2 text-text ${className}`}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[name]} />
      </svg>
    </span>
  );
}
