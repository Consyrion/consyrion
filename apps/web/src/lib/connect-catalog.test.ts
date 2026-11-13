import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/all-messages";
import { LOCALES } from "@/i18n/locales";
import {
  CONNECT_CATEGORIES,
  CONNECT_ITEMS,
  DETAIL_SLUGS,
  OBSIDIAN_DOWNLOADS,
  SIGN_IN_SLUGS,
  TOKEN_PLACEHOLDER,
  connectHref,
  connectSteps,
  isDetailSlug,
} from "./connect-catalog";
import { CONNECT_BRANDS } from "@/components/connect/connect-brands";

type Tree = Record<string, unknown>;
const at = (tree: unknown, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);

describe("connect catalog (integrations grid, 08.11.26)", () => {
  const mcpUrl = "https://app.example.test/api/mcp";

  it("puts every item in a known category and has a detail page for each available non-anchor tool", () => {
    for (const item of CONNECT_ITEMS) {
      expect(CONNECT_CATEGORIES).toContain(item.category);
      if (item.status === "available" && !item.anchor) expect(isDetailSlug(item.slug), item.slug).toBe(true);
    }
    expect(new Set(CONNECT_ITEMS.map((i) => i.slug)).size).toBe(CONNECT_ITEMS.length);
  });

  it("shows a company mark for tools of one company and never one for VS Code (11.11.26)", () => {
    const brandOf = Object.fromEntries(CONNECT_ITEMS.map((i) => [i.slug, i.brand]));
    expect(brandOf).toMatchObject({
      "claude-code": "claude",
      "claude-desktop": "claude",
      cursor: "cursor",
      telegram: "telegram",
      obsidian: "obsidian",
      github: "github",
      confluence: "confluence",
    });
    // Microsoft forbids its icon on third-party product pages; e-mail and the mixed connector card have no single company.
    for (const slug of ["vscode", "vscode-extension", "email", "chatgpt", "codex", "gemini-cli", "hermes", "openclaw"])
      expect(brandOf[slug], slug).toBeUndefined();
    for (const item of CONNECT_ITEMS) {
      if (!item.brand) continue;
      const mark = CONNECT_BRANDS[item.brand];
      expect(mark.path.length, item.brand).toBeGreaterThan(50);
      if (mark.color) expect(mark.color, item.brand).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("links planned tools nowhere, anchors to settings and the rest to the public setup page", () => {
    for (const item of CONNECT_ITEMS) {
      const href = connectHref(item);
      if (item.status === "planned") expect(href).toBeNull();
      else if (item.anchor) expect(href).toBe(`/settings/integrations#${item.anchor}`);
      else expect(href).toBe(`/integrations/${item.slug}`);
    }
  });

  it("builds snippets with this server's MCP address; a token appears only as a placeholder in the alternative step", () => {
    for (const slug of DETAIL_SLUGS) {
      const steps = connectSteps(slug, mcpUrl);
      const codes = steps.flatMap((s) => (s.code ? [s.code.text] : []));
      expect(codes.length, slug).toBeGreaterThan(0);
      if (slug !== "telegram") expect(codes.join("\n"), slug).toContain(mcpUrl);
      for (const step of steps) {
        // Signing in is the normal way: only the shared "token as the alternative" step may show the placeholder.
        if (step.code?.text.includes(TOKEN_PLACEHOLDER)) expect(step.key, slug).toBe("tokenAlt");
        if (step.key === "tokenAlt") expect(step.code?.text, slug).toContain(TOKEN_PLACEHOLDER);
      }
      for (const text of codes) expect(text).not.toMatch(/\bcn[rsi]_[A-Za-z0-9]/);
    }
  });

  it("offers the sign-in way for every MCP client and never asks for a token first", () => {
    for (const slug of SIGN_IN_SLUGS) {
      const steps = connectSteps(slug, mcpUrl);
      expect(steps[0]!.key, slug).not.toBe("token");
      expect(
        steps.some((s) => s.key === "signIn" || s.key === "signin"),
        slug,
      ).toBe(true);
      expect(CONNECT_ITEMS.find((i) => i.slug === slug)?.needsMcp, slug).toBe(true);
    }
  });

  it("builds the one-click install links of Cursor and VS Code from this server's address", () => {
    const cursor = connectSteps("cursor", mcpUrl).find((s) => s.install)!.install!;
    const config = new URL(cursor).searchParams.get("config")!;
    expect(cursor.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?name=consyrium&config=")).toBe(true);
    expect(JSON.parse(atob(config))).toEqual({ url: mcpUrl });
    const vscode = connectSteps("vscode", mcpUrl).find((s) => s.install)!.install!;
    expect(vscode.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(vscode.slice("vscode:mcp/install?".length)))).toEqual({ name: "consyrium", type: "http", url: mcpUrl });
  });

  it("offers the Obsidian plugin without the MCP entitlement and serves its two files from this server", () => {
    const item = CONNECT_ITEMS.find((i) => i.slug === "obsidian")!;
    expect(item).toMatchObject({ status: "available", needsMcp: false });
    // Signing in replaced the token step (plugin 0.3.0): no step asks for a token, none shows a token placeholder.
    const steps = connectSteps("obsidian", mcpUrl);
    expect(steps.map((s) => s.key)).toEqual(["download", "folder", "enable", "connect", "use", "mcp"]);
    expect(steps.flatMap((s) => (s.code ? [s.code.text] : [])).join("\n")).not.toContain(TOKEN_PLACEHOLDER);
    expect(Object.values(OBSIDIAN_DOWNLOADS)).toEqual(["/downloads/obsidian/main.js", "/downloads/obsidian/manifest.json"]);
    for (const locale of LOCALES) {
      const text = String(at(messagesFor(locale), "settings.connect.items.obsidian.steps.download"));
      expect(text, locale).toContain("<main>");
      expect(text, locale).toContain("<manifest>");
    }
  });

  it("produces valid JSON for the editor config files", () => {
    for (const slug of ["cursor", "vscode", "gemini-cli"] as const)
      for (const step of connectSteps(slug, mcpUrl).filter((s) => s.code?.label.endsWith(".json")))
        expect(() => JSON.parse(step.code!.text), slug).not.toThrow();
  });

  it("has every text in every interface language", () => {
    for (const locale of LOCALES) {
      const connect = at(messagesFor(locale), "settings.connect");
      for (const item of CONNECT_ITEMS) {
        for (const field of ["name", "by", "summary"])
          expect(at(connect, `items.${item.slug}.${field}`), `${locale} ${item.slug}.${field}`).toBeTypeOf("string");
      }
      for (const slug of DETAIL_SLUGS) {
        expect(at(connect, `items.${slug}.what`), `${locale} ${slug}.what`).toBeTypeOf("string");
        for (const step of connectSteps(slug, mcpUrl))
          expect(at(connect, step.shared ? `shared.${step.key}` : `items.${slug}.steps.${step.key}`), `${locale} ${slug}.${step.key}`).toBeTypeOf("string");
      }
      for (const key of ["signIn", "askAgent", "tokenAlt", "addButton", "untested", "tested"]) {
        expect(at(connect, `shared.${key}`), `${locale} shared.${key}`).toBeTypeOf("string");
      }
    }
  });
});
