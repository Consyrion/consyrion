"use client";

import { useRef, type ReactNode } from "react";

/**
 * Narrow-screen menu of the landing page (ChatGPT QA 07.11.26: section links, language and sign-in were hidden
 * below 768 px). A native <details>, so it works without JavaScript; with JavaScript a tap on a link closes it.
 */
export function MobileMenu({ label, summaryClassName, children }: { label: string; summaryClassName: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      className="relative md:hidden"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) ref.current?.removeAttribute("open");
      }}
    >
      <summary className={summaryClassName} aria-label={label}>
        <span aria-hidden="true">☰</span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 flex w-56 flex-col gap-1 rounded-xl border border-glass-line bg-bg p-3 text-sm shadow-2xl">{children}</div>
    </details>
  );
}
