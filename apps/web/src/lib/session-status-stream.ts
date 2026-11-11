/**
 * Live status of a council for small widgets (#12, #215 start card): listens to the server-sent `usage` event of
 * /api/sessions/{id}/events and falls back to asking every 5 s when the stream breaks or EventSource is missing.
 * Returns a function that stops everything.
 */
export interface SessionStatus {
  status: string;
  phase: string | null;
  tokens: number;
}

type Source = { addEventListener(type: string, listener: (event: { data: string }) => void): void; onerror: (() => void) | null; close(): void };

export function followSessionStatus(
  sessionId: string,
  onStatus: (s: SessionStatus) => void,
  deps: {
    createSource?: ((url: string) => Source) | null;
    load: () => Promise<SessionStatus>;
    wait?: (ms: number, run: () => void) => void;
  },
): () => void {
  let stop = false;
  let source: Source | null = null;
  const running = (s: string) => s === "queued" || s === "running";
  const wait = deps.wait ?? ((ms, run) => void setTimeout(run, ms));
  const poll = async () => {
    try {
      const s = await deps.load();
      if (stop) return;
      onStatus(s);
      if (running(s.status)) wait(5_000, () => void poll());
    } catch {
      /* the link to the session still works */
    }
  };
  if (!deps.createSource) void poll();
  else {
    source = deps.createSource(`/api/sessions/${sessionId}/events`);
    source.addEventListener("usage", (event) => {
      try {
        const u = JSON.parse(event.data) as { status: string; phase: string | null; tokensUsed: number };
        onStatus({ status: u.status, phase: u.phase, tokens: u.tokensUsed });
        if (!running(u.status)) source?.close();
      } catch {
        /* ignore a malformed event */
      }
    });
    source.onerror = () => {
      source?.close();
      source = null;
      if (!stop) void poll();
    };
  }
  return () => {
    stop = true;
    source?.close();
  };
}
