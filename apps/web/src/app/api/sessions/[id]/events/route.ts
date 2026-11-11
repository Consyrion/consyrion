import { getSessionView, sessionTimeline, sessionUsageSnapshot } from "@consyrium/council";
import { createHash } from "node:crypto";
import { requireActor } from "@/lib/server/actor";
import { handle } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["cancelled", "failed", "approved", "rejected", "changes_requested", "awaiting_approval"]);
const TICK_MS = 1_500;

/**
 * Server-sent events of a run:
 * - `session`: the full session view whenever it changes (the real stored state);
 * - `usage`: running totals (calls, tokens, budget share, current phase) whenever they change – small, for live counters;
 * - `timeline`: every timeline event once, in order, with its cursor as SSE `id` (#12). A reconnecting browser sends the
 *   last id as `Last-Event-ID`; other clients pass `?after=<cursor>`. The stream resumes after it without gaps or repeats.
 * The stream closes once the run needs no live updates and every timeline event has been sent.
 */
export const GET = handle(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const actor = await requireActor({ integration: true });
  const db = await getDb();
  const id = (await params).id;
  let cursor = request.headers.get("last-event-id") || new URL(request.url).searchParams.get("after") || null;
  await getSessionView(db, actor, id); // authorization check before opening the stream
  if (cursor) await sessionTimeline(db, actor, id, { after: cursor, limit: 1 }); // a malformed cursor fails here as 422
  const encoder = new TextEncoder();
  let lastHash = "";
  let lastUsage = "";
  const stream = new ReadableStream({
    async start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      write(`retry: 3000\n\n`);
      // A read can fail for a moment (e.g. while the Final Verdict is written); the stream retries instead of ending,
      // because a browser whose reconnect gets an error response stops listening for good (QA 07.11.26: the page kept
      // showing "running" after the verdict was stored).
      let failures = 0;
      try {
        while (!request.signal.aborted) {
          let view: Awaited<ReturnType<typeof getSessionView>>;
          let timeline: Awaited<ReturnType<typeof sessionTimeline>>;
          try {
            view = await getSessionView(db, actor, id);
            timeline = await sessionTimeline(db, actor, id, { after: cursor });
            failures = 0;
          } catch (error) {
            if (++failures >= 5) throw error;
            await new Promise((resolve) => setTimeout(resolve, TICK_MS));
            continue;
          }
          const json = JSON.stringify(view);
          const hash = createHash("sha1").update(json).digest("hex");
          if (hash !== lastHash) {
            lastHash = hash;
            write(`event: session\ndata: ${json}\n\n`);
          }
          const usage = JSON.stringify(sessionUsageSnapshot(view));
          if (usage !== lastUsage) {
            lastUsage = usage;
            write(`event: usage\ndata: ${usage}\n\n`);
          }
          for (const event of timeline.events) write(`id: ${event.cursor}\nevent: timeline\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = timeline.nextCursor;
          // A full page means more events are waiting – fetch them right away instead of after a tick.
          if (timeline.events.length >= 200) continue;
          // Final runs keep the stream open until the settle window has passed and the last events are out.
          if (TERMINAL.has(view.session.status) && timeline.complete) break;
          await new Promise((resolve) => setTimeout(resolve, TICK_MS));
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
