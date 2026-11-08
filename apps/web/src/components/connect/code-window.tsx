"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** A copyable snippet drawn as a small app window (title bar with the file or tool name). */
export function CodeWindow({ label, text }: { label: string; text: string }) {
  const t = useTranslations("settings.connect");
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-glass-line bg-bg">
      <div className="flex items-center gap-2 border-b border-glass-line bg-surface-2 px-3 py-2">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-danger/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
        </span>
        <span className="truncate font-mono text-xs text-muted">{label}</span>
        <button
          type="button"
          className="ml-auto rounded-md px-2 py-0.5 text-xs text-muted hover:bg-surface hover:text-text"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}
