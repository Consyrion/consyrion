"use client";

import { useTranslations } from "next-intl";
import { Button } from "./ui/button";

/** Same name as OPEN_ASSISTANT_EVENT in assistant-panel.tsx (kept here so callers do not load the panel module). */
const OPEN_ASSISTANT_EVENT = "consyrium:open-assistant";

/**
 * Opens the assistant panel from any component (#279), optionally with a question pre-filled. The question is not sent:
 * the user reads it, may change it and sends it (a question costs tokens on their key). On a decision page the
 * decision is the context automatically.
 */
export function openAssistant(options: { prompt?: string } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_ASSISTANT_EVENT, { detail: options }));
}

/** "Ask the AI" button, e.g. next to a verdict: opens the panel with a question about the current page. */
export function AskAssistantButton({ prompt, variant = "secondary" }: { prompt?: string; variant?: "secondary" | "ghost" }) {
  const t = useTranslations("assistant");
  return (
    <Button type="button" variant={variant} onClick={() => openAssistant({ prompt: prompt ?? t("askAboutDecision") })}>
      {t("ask")}
    </Button>
  );
}
