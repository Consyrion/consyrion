"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Status of a skill's requirement building blocks on the council setup (#420): "adopted" when a requirement matches the
 * block (its `{gap}` placeholders match any filled-in value), "dismissed" when the user consciously set it aside, else
 * "open". Nothing here changes a requirement – adopting a block still goes through the intake and its confirmation.
 */
export type SkillBlockStatus = "adopted" | "open" | "dismissed";

const GAP = /\{([^{}]{1,40})\}/g;
const normalise = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .toLowerCase();

/** Whether a requirement text is this block with its gaps filled in (case, spacing and the final full stop ignored). */
export function blockMatches(block: string, text: string): boolean {
  const parts = normalise(block).split(GAP);
  // split() with a capture group alternates literal text and gap names: keep the literals, gaps become wildcards.
  const pattern = parts.map((part, i) => (i % 2 === 0 ? part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "[^{}]+?")).join("");
  return new RegExp(`^${pattern}$`).test(normalise(text));
}

export function skillBlockStatuses(blocks: string[], requirements: string[], dismissed: ReadonlySet<string>): SkillBlockStatus[] {
  return blocks.map((block) => (requirements.some((r) => blockMatches(block, r)) ? "adopted" : dismissed.has(block) ? "dismissed" : "open"));
}

export function countStatuses(statuses: SkillBlockStatus[]) {
  return {
    adopted: statuses.filter((s) => s === "adopted").length,
    open: statuses.filter((s) => s === "open").length,
    dismissed: statuses.filter((s) => s === "dismissed").length,
  };
}

const EVENT = "consyrion:skill-blocks-dismissed";

function read(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The blocks the user set aside, per project and skill version. Kept in the browser only: "dismissed" is a personal
 * reading aid, not a decision – it never removes or confirms anything. Shared between the intake and the start summary.
 */
export function useDismissedSkillBlocks(storageKey: string | null): [ReadonlySet<string>, (block: string, dismissed: boolean) => void] {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!storageKey) return;
    const sync = () => setDismissed(read(storageKey));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [storageKey]);
  const toggle = useCallback(
    (block: string, value: boolean) => {
      if (!storageKey) return;
      const next = read(storageKey);
      if (value) next.add(block);
      else next.delete(block);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {
        // Storage blocked (private window): the status lasts for this page view only.
      }
      setDismissed(next);
      window.dispatchEvent(new Event(EVENT));
    },
    [storageKey],
  );
  return [dismissed, toggle];
}
