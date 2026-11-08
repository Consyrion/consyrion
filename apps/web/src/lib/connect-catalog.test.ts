import { describe, expect, it } from "vitest";
import { messagesFor } from "@/i18n/all-messages";
import { LOCALES } from "@/i18n/locales";
import { CONNECT_CATEGORIES, CONNECT_ITEMS, DETAIL_SLUGS, TOKEN_PLACEHOLDER, connectHref, connectSteps, isDetailSlug } from "./connect-catalog";

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

  it("links planned tools nowhere, anchors to settings and the rest to the public setup page", () => {
    for (const item of CONNECT_ITEMS) {
      const href = connectHref(item);
      if (item.status === "planned") expect(href).toBeNull();
      else if (item.anchor) expect(href).toBe(`/settings/integrations#${item.anchor}`);
      else expect(href).toBe(`/integrations/${item.slug}`);
    }
  });

  it("builds snippets with this server's MCP address and only a token placeholder", () => {
    for (const slug of DETAIL_SLUGS) {
      const codes = connectSteps(slug, mcpUrl).flatMap((s) => (s.code ? [s.code.text] : []));
      expect(codes.length, slug).toBeGreaterThan(0);
      if (slug !== "telegram") {
        expect(codes.join("\n"), slug).toContain(mcpUrl);
        expect(codes.join("\n"), slug).toContain(TOKEN_PLACEHOLDER);
      }
      for (const text of codes) expect(text).not.toMatch(/\bcn[rsi]_[A-Za-z0-9]/);
    }
  });

  it("produces valid JSON for the editor config files", () => {
    for (const slug of ["cursor", "vscode", "claude-desktop"] as const) {
      const json = connectSteps(slug, mcpUrl).find((s) => s.code?.label.endsWith(".json"));
      expect(() => JSON.parse(json!.code!.text), slug).not.toThrow();
    }
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
          expect(at(connect, `items.${slug}.steps.${step.key}`), `${locale} ${slug}.${step.key}`).toBeTypeOf("string");
      }
    }
  });
});
