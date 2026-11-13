import { createDatabase, ensurePersonalOrganization, registerClient, resolveActor, schema, type ActorContext, type DatabaseHandle } from "@consyrium/db";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let handle: DatabaseHandle;
let actor: ActorContext;
let sessionUser: { id: string; email: string } | null = null;
vi.mock("@/lib/server/db", () => ({ getDb: async () => handle.db }));
vi.mock("@/lib/server/actor", () => ({ getSessionUser: async () => sessionUser, requireActor: async () => actor }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ""}`,
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/components/auth-shell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("./consent-form", () => ({
  ConsentForm: (props: { query: string; organizationId: string; target: string }) => (
    <form data-query={props.query} data-org={props.organizationId} data-target={props.target} />
  ),
}));

const { default: AuthorizePage } = await import("./page");
const render = async (params: Record<string, string | string[] | undefined>) =>
  renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(params) }));

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
let clientId: string;
const request = (extra: Record<string, string | undefined> = {}) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: "https://client.example/cb?x=1",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  state: "s1",
  ...extra,
});

beforeAll(async () => {
  handle = createDatabase("memory://");
  await handle.migrate();
  await handle.db.insert(schema.user).values({ id: "u", name: "U", email: "u@example.test" });
  actor = await resolveActor(handle.db, "u", (await ensurePersonalOrganization(handle.db, "u", "U")).id);
  clientId = (await registerClient(handle.db, { name: "Totally Official App", redirectUris: ["https://client.example/cb?x=1"] })).clientId;
});
afterAll(async () => {
  await handle.close();
});
beforeEach(() => {
  sessionUser = { id: "u", email: "u@example.test" };
});

describe("OAuth consent page", () => {
  it("shows the client, where the access goes, the workspace and the scope to a signed-in user", async () => {
    const html = await render(request());
    expect(html).toContain("Totally Official App");
    // Scheme and host of the redirect URI – without path or query – and the note that the app is not verified.
    expect(html).toContain(">https://client.example<");
    expect(html).toContain("targetUnverified");
    expect(html).not.toContain("targetFirstParty");
    expect(html).toContain("U workspace");
    expect(html).toContain("scope.councils");
    expect(html).toContain("validity{&quot;days&quot;:90}");
    expect(html).toContain(`data-org="${actor.organizationId}"`);
    expect(html).toContain('data-target="https://client.example"');
  });

  it("marks the built-in Obsidian client as official and shows the read scope when asked for", async () => {
    const html = await render(request({ client_id: "consyrium-obsidian", redirect_uri: "obsidian://consyrium-auth", scope: "read" }));
    expect(html).toContain("CONSYRIUM AI for Obsidian");
    expect(html).toContain(">obsidian://consyrium-auth<");
    expect(html).toContain("targetFirstParty");
    expect(html).toContain("scope.read");
  });

  it("an invalid request is explained and never redirected – also not for a signed-out visitor", async () => {
    for (const session of [sessionUser, null]) {
      sessionUser = session;
      for (const [params, problem] of [
        [request({ redirect_uri: "https://evil.example/cb" }), "problem.redirect_uri"],
        [request({ redirect_uri: "https://client.example/cb" }), "problem.redirect_uri"],
        [request({ client_id: "cnc_unknown" }), "problem.client"],
        [request({ response_type: "token" }), "problem.response_type"],
        [request({ code_challenge: undefined }), "problem.pkce"],
        [request({ code_challenge_method: "plain" }), "problem.pkce"],
        [request({ scope: "full" }), "problem.scope"],
      ] as const) {
        const html = await render(params);
        expect(html).toContain("errorTitle");
        expect(html).toContain(problem);
        expect(html).not.toContain("<form");
      }
    }
  });

  it("a signed-out visitor signs in first and comes back to the same request", async () => {
    sessionUser = null;
    const error = await render(request({ scope: "read", ignored: "https://evil.example" })).catch((e: Error) => e.message);
    const expected = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "https://client.example/cb?x=1",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      scope: "read",
      state: "s1",
    });
    expect(error).toBe(`REDIRECT /sign-in?next=${encodeURIComponent(`/oauth/authorize?${expected.toString()}`)}`);
  });
});
