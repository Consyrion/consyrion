import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "./safe-next";

describe("safeNext", () => {
  const ok = "/oauth/authorize?response_type=code&client_id=consyrium-obsidian&redirect_uri=obsidian%3A%2F%2Fconsyrium-auth&code_challenge=abc&state=s";

  it("keeps the consent page of this origin", () => {
    expect(safeNext(ok)).toBe(ok);
    expect(safeNext("/oauth/authorize?x=1")).toBe("/oauth/authorize?x=1");
  });

  it("drops every other target", () => {
    for (const value of [
      null,
      undefined,
      42,
      ["/oauth/authorize?x=1"],
      "",
      "/",
      "/dashboard",
      "/oauth/authorize",
      "/oauth/authorizeX?x=1",
      "/oauth/authorize/../../dashboard?x=1",
      "oauth/authorize?x=1",
      "//evil.example/oauth/authorize?x=1",
      "/\\evil.example/oauth/authorize?x=1",
      "https://evil.example/oauth/authorize?x=1",
      "https://app.consyrium.com/oauth/authorize?x=1",
      "javascript:alert(1)//oauth/authorize?x=1",
      // No raw "//", backslash, fragment, whitespace or control character anywhere – also not inside the query.
      "/oauth/authorize?redirect_uri=https://evil.example/cb",
      "/oauth/authorize?x=\\evil",
      "/oauth/authorize?x=1#frag",
      "/oauth/authorize?x=1 2",
      "/oauth/authorize?x=1\n",
      "/oauth/authorize?x=1\u0000",
      ` ${ok}`,
      `/oauth/authorize?x=${"a".repeat(2000)}`,
    ])
      expect(safeNext(value), String(value)).toBeNull();
  });

  it("builds sign-in links that carry only a safe target", () => {
    expect(withNext("/sign-in", ok)).toBe(`/sign-in?next=${encodeURIComponent(ok)}`);
    expect(withNext("/sign-up", "https://evil.example")).toBe("/sign-up");
    expect(withNext("/sign-in", null)).toBe("/sign-in");
  });
});
