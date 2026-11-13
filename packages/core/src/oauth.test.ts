import { describe, expect, it } from "vitest";
import { cleanClientName, isAllowedRedirectUri, parseOAuthScope, redirectTarget, validRedirectUris } from "./oauth";

describe("OAuth redirect URIs", () => {
  it("allows https, http on the loopback interface and the listed app schemes", () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://example.com:8443/cb?x=1",
      "http://localhost/callback",
      "http://localhost:53682/callback",
      "http://127.0.0.1:8976/oauth/callback",
      "http://[::1]:4000/cb",
      "obsidian://consyrium-auth",
      "cursor://anysphere.cursor-retrieval/oauth/user-consyrium/callback",
      "vscode://publisher.extension/callback",
      "vscode-insiders://publisher.extension/callback",
      "claude://oauth/callback",
    ])
      expect(isAllowedRedirectUri(uri), uri).toBe(true);
  });

  it("refuses everything else", () => {
    for (const uri of [
      "",
      "not a url",
      "/relative/path",
      "//evil.example/cb",
      "javascript:alert(1)",
      "javascript://localhost/%0aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com/cb",
      "http://example.com/cb",
      "http://localhost.evil.example/cb",
      "http://127.0.0.1.evil.example/cb",
      "http://192.168.1.10/cb",
      "https://example.com/cb#fragment",
      "http://localhost/cb#x",
      "https://user:pass@example.com/cb",
      "https://app.consyrium.com@evil.example/cb",
      "https:evil.example/cb",
      "https:/evil.example/cb",
      "https://",
      "https://exa mple.com/cb",
      "https://example.com/cb\n",
      "https://example.com\\@evil.example/cb",
      // Only our own Obsidian action, exactly – never another plugin's action or a look-alike.
      "obsidian://consyrium-auth-evil",
      "obsidian://consyrium-auth/x",
      "obsidian://consyrium-auth?vault=x",
      "obsidian://open?vault=x",
      "Obsidian://consyrium-auth",
      // Listed schemes need a target; unknown app schemes are refused.
      "cursor://",
      "vscode:",
      "vscode:publisher.extension/callback",
      "VSCODE://publisher.extension/callback",
      "slack://oauth/callback",
      "myapp://callback",
      "intent://scan/#Intent;scheme=zxing;end",
      `https://example.com/${"a".repeat(300)}`,
    ])
      expect(isAllowedRedirectUri(uri), uri).toBe(false);
    for (const value of [null, undefined, 1, {}, ["https://example.com/cb"]]) expect(isAllowedRedirectUri(value)).toBe(false);
  });

  it("takes 1 to 5 distinct URIs per client", () => {
    expect(validRedirectUris(["https://example.com/cb", "http://localhost:1/cb"])).toEqual(["https://example.com/cb", "http://localhost:1/cb"]);
    expect(validRedirectUris([])).toBeNull();
    expect(validRedirectUris("https://example.com/cb")).toBeNull();
    expect(validRedirectUris(["https://example.com/cb", "javascript:alert(1)"])).toBeNull();
    expect(validRedirectUris(["https://example.com/cb", "https://example.com/cb"])).toBeNull();
    expect(validRedirectUris(Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`))).toBeNull();
    expect(validRedirectUris(Array.from({ length: 5 }, (_, i) => `https://example.com/${i}`))).toHaveLength(5);
  });

  it("shows scheme and host as the target, never path or query", () => {
    expect(redirectTarget("https://claude.ai/api/mcp/auth_callback?x=https://app.consyrium.com")).toBe("https://claude.ai");
    expect(redirectTarget("http://localhost:53682/callback")).toBe("http://localhost:53682");
    expect(redirectTarget("obsidian://consyrium-auth")).toBe("obsidian://consyrium-auth");
    expect(redirectTarget("vscode://publisher.extension/callback")).toBe("vscode://publisher.extension");
    // Internationalised look-alikes are shown in their ASCII form.
    expect(redirectTarget("https://\u0430pp.example/cb")).toBe("https://xn--pp-6kc.example");
  });
});

describe("OAuth scope and client name", () => {
  it("maps the scope parameter; unknown names are refused", () => {
    expect(parseOAuthScope(undefined)).toBe("councils");
    expect(parseOAuthScope("")).toBe("councils");
    expect(parseOAuthScope("councils")).toBe("councils");
    expect(parseOAuthScope("read")).toBe("read");
    expect(parseOAuthScope("councils read")).toBe("councils");
    expect(parseOAuthScope("read councils")).toBe("councils");
    expect(parseOAuthScope("full")).toBeNull();
    expect(parseOAuthScope("read full")).toBeNull();
    expect(parseOAuthScope("integration")).toBeNull();
    expect(parseOAuthScope("councils,read")).toBeNull();
  });

  it("cleans client names", () => {
    expect(cleanClientName("  Claude Code  ")).toBe("Claude Code");
    expect(cleanClientName("Evil\u202eedoC edualC\n")).toBe("EviledoC edualC");
    expect(cleanClientName("")).toBeNull();
    expect(cleanClientName("   ")).toBeNull();
    expect(cleanClientName("x".repeat(81))).toBeNull();
    expect(cleanClientName(42)).toBeNull();
  });
});
