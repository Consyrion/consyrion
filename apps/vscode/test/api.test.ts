import { describe, expect, it } from "vitest";
import { ConsyrionApi, ConsyrionApiError, type FetchLike } from "../src/api";
import { escapeHtml, renderSessionHtml } from "../src/html";

describe("api client", () => {
  it("sends the bearer token and parses responses", async () => {
    const calls: Array<{ url: string; auth: string | null; body?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, auth: new Headers(init?.headers).get("Authorization"), body: init?.body as string | undefined });
      if (url.endsWith("/api/projects"))
        return new Response(
          JSON.stringify({
            projects: [
              { id: "p1", name: "A", status: "ready" },
              { id: "p2", name: "B", status: "archived" },
            ],
          }),
        );
      if (url.endsWith("/approval")) return new Response(JSON.stringify({ status: "approved" }));
      return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 });
    };
    const api = new ConsyrionApi("https://consyrion.test/", "cns_x", fetchImpl);
    expect(await api.projects()).toEqual([{ id: "p1", name: "A", status: "ready" }]);
    expect(calls[0]).toMatchObject({ url: "https://consyrion.test/api/projects", auth: "Bearer cns_x" });
    await api.approve("s/1", "approve", "ok");
    expect(calls[1]!.url).toBe("https://consyrion.test/api/sessions/s%2F1/approval");
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ action: "approve", comment: "ok" });
    await expect(api.session("missing")).rejects.toBeInstanceOf(ConsyrionApiError);
  });
});

describe("webview html", () => {
  it("escapes untrusted content and uses a nonce CSP", () => {
    const html = renderSessionHtml(
      {
        session: { id: "s", status: "awaiting_approval", mode: "consensus" },
        project: { name: "<img src=x onerror=alert(1)>" },
        stages: [{ phase: "final_verdict", status: "completed" }],
        proposals: [{ id: "p", label: "A", revisions: [{ content: { title: "<script>bad()</script>", summary: "s" } }] }],
        objections: [{ proposalId: "p", status: "unresolved", severity: "critical", category: "security", claim: '"><svg onload=x>', blocking: true }],
        decision: { outcome: "recommended", recommendedProposalId: "p" },
      },
      "abc123",
      true,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>bad()");
    expect(html).not.toContain("<svg onload");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain("blocks approval");
    expect(escapeHtml(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
  });

  it("shows needs_verification and unknown outcomes neutrally and offers no Approve button (#181, stage 1)", () => {
    const base = {
      session: { id: "s", status: "awaiting_approval", mode: "consensus" },
      project: { name: "P" },
      stages: [],
      proposals: [{ id: "p", label: "A", revisions: [{ content: { title: "T", summary: "S" } }] }],
      objections: [],
    };
    const blocked = renderSessionHtml(
      {
        ...base,
        decision: { outcome: "needs_verification", recommendedProposalId: null },
        decisionStatus: { approvable: false, reason: "Needs verification – not approvable.", canApproveRecommendation: false },
      },
      "n",
      true,
    );
    expect(blocked).toContain("Needs verification – not approvable.");
    expect(blocked).not.toContain('data-action="approve"');
    const unknown = renderSessionHtml({ ...base, decision: { outcome: "qualified", recommendedProposalId: "p" } }, "n", true);
    expect(unknown).not.toContain("qualified");
    expect(unknown).not.toContain('data-action="approve"');
    const legacy = renderSessionHtml(
      {
        ...base,
        decision: { outcome: "recommended", recommendedProposalId: "p" },
        decisionStatus: { approvable: true, reason: null, canApproveRecommendation: true },
      },
      "n",
      true,
    );
    expect(legacy).toContain("Recommended solution");
    expect(legacy).toContain('data-action="approve"');
  });
});
