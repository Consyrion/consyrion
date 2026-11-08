/**
 * Catalog for the "Connect your tools" grid (08.11.26): public at /integrations (linked from the homepage) and on
 * Settings → Integrations.
 * One entry per tool people use CONSYRION AI from. Texts live in messages/settings (settings.connect.items.<slug>);
 * this file only holds structure and the copy-paste snippets, which need the server address.
 * Only what works today is "available"; anything else is marked "planned" (CLAUDE.md: no invented features).
 */

export type ConnectCategory = "aiClients" | "apps" | "delivery";
export type ConnectIcon = "terminal" | "cursor" | "code" | "desktop" | "puzzle" | "telegram" | "github" | "mail" | "doc" | "chat";
export type ConnectStatus = "available" | "planned";

export type ConnectItem = {
  slug: string;
  category: ConnectCategory;
  icon: ConnectIcon;
  status: ConnectStatus;
  /** Needs the plan entitlement `mcp` (hosted: Pro and up; self-hosted: always on). */
  needsMcp: boolean;
  /** Set when the tool is managed further down on the integrations page itself (no detail page). */
  anchor?: "github" | "delivery";
};

export const CONNECT_CATEGORIES: ConnectCategory[] = ["aiClients", "apps", "delivery"];

export const CONNECT_ITEMS: ConnectItem[] = [
  { slug: "claude-code", category: "aiClients", icon: "terminal", status: "available", needsMcp: true },
  { slug: "cursor", category: "aiClients", icon: "cursor", status: "available", needsMcp: true },
  { slug: "vscode", category: "aiClients", icon: "code", status: "available", needsMcp: true },
  { slug: "claude-desktop", category: "aiClients", icon: "desktop", status: "available", needsMcp: true },
  { slug: "telegram", category: "apps", icon: "telegram", status: "available", needsMcp: true },
  { slug: "vscode-extension", category: "apps", icon: "puzzle", status: "planned", needsMcp: false },
  { slug: "chat-connectors", category: "apps", icon: "chat", status: "planned", needsMcp: false },
  { slug: "github", category: "delivery", icon: "github", status: "available", needsMcp: false, anchor: "github" },
  { slug: "email", category: "delivery", icon: "mail", status: "available", needsMcp: false, anchor: "delivery" },
  { slug: "confluence", category: "delivery", icon: "doc", status: "available", needsMcp: false, anchor: "delivery" },
];

/** Tools with their own public setup page (/integrations/<slug>). */
export const DETAIL_SLUGS = ["claude-code", "cursor", "vscode", "claude-desktop", "telegram"] as const;
export type DetailSlug = (typeof DETAIL_SLUGS)[number];

export function isDetailSlug(slug: string): slug is DetailSlug {
  return (DETAIL_SLUGS as readonly string[]).includes(slug);
}

export function connectItem(slug: string): ConnectItem | undefined {
  return CONNECT_ITEMS.find((i) => i.slug === slug);
}

/** Where a card links to: its own setup page, a section further down, or nowhere (planned). */
export function connectHref(item: ConnectItem): string | null {
  if (item.status === "planned") return null;
  if (item.anchor) return `/settings/integrations#${item.anchor}`;
  return `/integrations/${item.slug}`;
}

/** Placeholder people replace with their own token – never a real token. */
export const TOKEN_PLACEHOLDER = "<TOKEN>";

export type ConnectStep = {
  /** Key under settings.connect.items.<slug>.steps */
  key: string;
  /** Optional code block shown under the step, with its language label for the header. */
  code?: { label: string; text: string };
};

/** Setup steps per tool. `mcpUrl` is this server's MCP endpoint (e.g. https://app.consyrion.com/api/mcp). */
export function connectSteps(slug: DetailSlug, mcpUrl: string): ConnectStep[] {
  const bearer = `Bearer ${TOKEN_PLACEHOLDER}`;
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  switch (slug) {
    case "claude-code":
      return [
        { key: "token" },
        { key: "add", code: { label: "Terminal", text: `claude mcp add --transport http consyrion ${mcpUrl} --header "Authorization: ${bearer}"` } },
        { key: "check", code: { label: "Claude Code", text: "/mcp" } },
        { key: "ask" },
      ];
    case "cursor":
      return [
        { key: "token" },
        { key: "open" },
        { key: "paste", code: { label: "~/.cursor/mcp.json", text: json({ mcpServers: { consyrion: { url: mcpUrl, headers: { Authorization: bearer } } } }) } },
        { key: "ask" },
      ];
    case "vscode":
      return [
        { key: "token" },
        {
          key: "paste",
          code: { label: ".vscode/mcp.json", text: json({ servers: { consyrion: { type: "http", url: mcpUrl, headers: { Authorization: bearer } } } }) },
        },
        { key: "start" },
        { key: "ask" },
      ];
    case "claude-desktop":
      return [
        { key: "token" },
        { key: "open" },
        {
          key: "paste",
          code: {
            label: "claude_desktop_config.json",
            text: json({
              mcpServers: {
                consyrion: {
                  command: "npx",
                  args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${CONSYRION_AUTH}"],
                  env: { CONSYRION_AUTH: bearer },
                },
              },
            }),
          },
        },
        { key: "restart" },
      ];
    case "telegram":
      return [
        { key: "bot", code: { label: "Telegram", text: "@BotFather → /newbot" } },
        { key: "chat" },
        { key: "connect" },
        { key: "allow" },
        { key: "ask", code: { label: "Telegram", text: "/frage PostgreSQL oder SQLite für 50 Nutzer?\n- muss selbst gehostet laufen" } },
      ];
  }
}
