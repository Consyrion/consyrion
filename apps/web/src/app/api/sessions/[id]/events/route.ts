import { getSessionView } from "@consyrion/council";
import { createHash } from "node:crypto";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["cancelled", "failed", "approved", "rejected", "changes_requested", "awaiting_approval"]);

/**
 * Server-sent events with the session view whenever it changes. Every event is the real stored
 * state; the stream closes when the run reaches a state that needs no live updates.
 */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const db = await getDb();
  const id = (await params).id;
  await getSessionView(db, actor, id); // authorization check before opening the stream
  const encoder = new TextEncoder();
  let lastHash = "";
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        while (!request.signal.aborted) {
          const view = await getSessionView(db, actor, id);
          const json = JSON.stringify(view);
          const hash = createHash("sha1").update(json).digest("hex");
          if (hash !== lastHash) {
            lastHash = hash;
            controller.enqueue(encoder.encode(`event: session\ndata: ${json}\n\n`));
          }
          if (TERMINAL.has(view.session.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        }
      } catch {
        send("error", { message: "Stream interrupted" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
});
