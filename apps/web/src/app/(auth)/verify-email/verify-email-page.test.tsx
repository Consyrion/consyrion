import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A signed-in visitor must not stay on "confirmed – sign in" (live bug 08.11.26: sign-in → /verify-email → sign-in loop).
let sessionUser: { id: string } | null = null;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/actor", () => ({ getSessionUser: async () => sessionUser }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { default: VerifyEmailPage } = await import("./page");
const render = (params: { error?: string }) => VerifyEmailPage({ searchParams: Promise.resolve(params) });

describe("verify-email page", () => {
  beforeEach(() => {
    sessionUser = null;
  });

  it("sends a signed-in user on to the dashboard (the client follows callbackURL after a successful sign-in)", async () => {
    sessionUser = { id: "u1" };
    await expect(render({})).rejects.toThrow("REDIRECT /dashboard");
  });

  it("confirms the address for a visitor without a session (verification link)", async () => {
    const page = await render({});
    expect(renderToStaticMarkup(page)).toContain("verifyTitle");
  });

  it("explains an invalid link even with a session", async () => {
    sessionUser = { id: "u1" };
    const page = await render({ error: "INVALID_TOKEN" });
    expect(renderToStaticMarkup(page)).toContain("verifyFailedTitle");
  });
});
