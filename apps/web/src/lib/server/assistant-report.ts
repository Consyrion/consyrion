import "server-only";
import { redactSecrets } from "@consyrium/core";

/**
 * "Report conversation" (#486 part 3): the excerpt of an assistant chat that goes to the feedback inbox – built on the
 * server only, shown to the user as a preview before anything is sent, and exactly that text is stored. The last
 * messages (newest kept), each shortened; only who wrote it, the model and the text – no tool data, links, actions, ids
 * or tokens; anything that looks like a key is replaced. Fits the feedback text limit together with the explanation.
 */
export const REPORT_LIMITS = { messages: 10, perMessage: 1_500, excerpt: 3_000, explanation: 800 } as const;

export function reportExcerpt(
  messages: Array<{ role: string; content: string; model?: string | null; reviewOf?: string | null }>,
  labels: { you: string; assistant: string; secondOpinion: string },
): string {
  const blocks: string[] = [];
  let size = 0;
  for (const m of messages.slice(-REPORT_LIMITS.messages).reverse()) {
    const who = m.role === "user" ? labels.you : `${m.reviewOf ? labels.secondOpinion : labels.assistant}${m.model ? ` (${m.model})` : ""}`;
    const text = redactSecrets(m.content.replace(/\s+\n/g, "\n").trim());
    const short = text.length > REPORT_LIMITS.perMessage ? `${text.slice(0, REPORT_LIMITS.perMessage)} …` : text;
    const block = `${who}: ${short}`;
    if (size + block.length > REPORT_LIMITS.excerpt) {
      if (!blocks.length) blocks.push(`${block.slice(0, REPORT_LIMITS.excerpt)} …`);
      break;
    }
    blocks.push(block);
    size += block.length + 2;
  }
  return blocks.reverse().join("\n\n");
}
