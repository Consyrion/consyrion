/**
 * Catalog for the "Connect your tools" grid (08.11.26): public at /integrations (linked from the homepage) and on
 * Settings → Integrations.
 * One entry per tool people use CONSYRIUM AI from. Texts live in messages/settings (settings.connect.items.<slug>);
 * this file only holds structure and the copy-paste snippets, which need the server address.
 * Only what works today is "available"; anything else is marked "planned" (CLAUDE.md: no invented features).
 */

export type ConnectCategory = "aiClients" | "apps" | "delivery";
export type ConnectIcon = "terminal" | "cursor" | "code" | "desktop" | "puzzle" | "telegram" | "github" | "mail" | "doc" | "chat" | "note";
/** Company mark shown instead of the line glyph (components/connect/connect-brands.ts). */
export type ConnectBrand = "claude" | "cursor" | "telegram" | "obsidian" | "github" | "confluence";
export type ConnectStatus = "available" | "planned";

export type ConnectItem = {
  slug: string;
  category: ConnectCategory;
  icon: ConnectIcon;
  /** Set when the tool belongs to one company whose mark may be shown; the glyph stays the fallback. */
  brand?: ConnectBrand;
  status: ConnectStatus;
  /** Needs the plan entitlement `mcp` (hosted: Pro and up; self-hosted: always on). */
  needsMcp: boolean;
  /** Set when the tool is managed further down on the integrations page itself (no detail page). */
  anchor?: "github" | "delivery";
};

export const CONNECT_CATEGORIES: ConnectCategory[] = ["aiClients", "apps", "delivery"];

export const CONNECT_ITEMS: ConnectItem[] = [
  { slug: "claude-code", category: "aiClients", icon: "terminal", brand: "claude", status: "available", needsMcp: true },
  { slug: "cursor", category: "aiClients", icon: "cursor", brand: "cursor", status: "available", needsMcp: true },
  { slug: "vscode", category: "aiClients", icon: "code", status: "available", needsMcp: true },
  { slug: "claude-desktop", category: "aiClients", icon: "desktop", brand: "claude", status: "available", needsMcp: true },
  { slug: "chatgpt", category: "aiClients", icon: "chat", status: "available", needsMcp: true },
  { slug: "codex", category: "aiClients", icon: "terminal", status: "available", needsMcp: true },
  { slug: "gemini-cli", category: "aiClients", icon: "terminal", status: "available", needsMcp: true },
  { slug: "hermes", category: "aiClients", icon: "terminal", status: "available", needsMcp: true },
  { slug: "openclaw", category: "aiClients", icon: "terminal", status: "available", needsMcp: true },
  { slug: "telegram", category: "apps", icon: "telegram", brand: "telegram", status: "available", needsMcp: true },
  { slug: "obsidian", category: "apps", icon: "note", brand: "obsidian", status: "available", needsMcp: false },
  { slug: "vscode-extension", category: "apps", icon: "puzzle", status: "planned", needsMcp: false },
  { slug: "github", category: "delivery", icon: "github", brand: "github", status: "available", needsMcp: false, anchor: "github" },
  { slug: "email", category: "delivery", icon: "mail", status: "available", needsMcp: false, anchor: "delivery" },
  { slug: "confluence", category: "delivery", icon: "doc", brand: "confluence", status: "available", needsMcp: false, anchor: "delivery" },
];

/** Tools with their own public setup page (/integrations/<slug>). */
export const DETAIL_SLUGS = [
  "claude-code",
  "cursor",
  "vscode",
  "claude-desktop",
  "chatgpt",
  "codex",
  "gemini-cli",
  "hermes",
  "openclaw",
  "telegram",
  "obsidian",
] as const;

/**
 * Clients whose guide uses the browser sign-in of the MCP server (OAuth, docs/mcp.md). The guides follow each vendor's
 * documentation (read 12.11.26); the sign-in itself was checked with the official MCP SDK client, not inside every
 * product – the page says so (settings.connect.shared.untested).
 */
export const SIGN_IN_SLUGS: readonly DetailSlug[] = [
  "claude-code",
  "cursor",
  "vscode",
  "claude-desktop",
  "chatgpt",
  "codex",
  "gemini-cli",
  "hermes",
  "openclaw",
];

/** Sign-in guides that were walked through completely inside the product (others: documentation + SDK check only). */
export const TESTED_SIGN_IN_SLUGS: readonly DetailSlug[] = ["claude-code", "codex", "claude-desktop", "chatgpt", "gemini-cli"];
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

/** Where the web image serves the built Obsidian plugin (Dockerfile.web copies apps/obsidian/dist there). */
export const OBSIDIAN_DOWNLOADS = { main: "/downloads/obsidian/main.js", manifest: "/downloads/obsidian/manifest.json" } as const;

/** Placeholder people replace with their own token – never a real token. */
export const TOKEN_PLACEHOLDER = "<TOKEN>";

export type ConnectStep = {
  /** Key under settings.connect.items.<slug>.steps – or under settings.connect.shared when `shared` is set. */
  key: string;
  /** The text is the same for every client (sign in, ask, token as the alternative). */
  shared?: boolean;
  /** One-click install link of the client (its own URL scheme), shown as a button under the step. */
  install?: string;
  /** Optional code block shown under the step, with its language label for the header. */
  code?: { label: string; text: string };
};

/** Setup steps per tool. `mcpUrl` is this server's MCP endpoint (e.g. https://app.consyrium.com/api/mcp). */
export function connectSteps(slug: DetailSlug, mcpUrl: string): ConnectStep[] {
  const bearer = `Bearer ${TOKEN_PLACEHOLDER}`;
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const signIn: ConnectStep = { key: "signIn", shared: true };
  const ask: ConnectStep = { key: "askAgent", shared: true };
  const tokenAlt = (label: string, text: string): ConnectStep => ({ key: "tokenAlt", shared: true, code: { label, text } });
  switch (slug) {
    case "claude-code":
      return [
        { key: "add", code: { label: "Terminal", text: `claude mcp add --transport http consyrium ${mcpUrl}` } },
        { key: "signin", code: { label: "Claude Code", text: "/mcp" } },
        { key: "ask" },
        tokenAlt("Terminal", `claude mcp add --transport http consyrium ${mcpUrl} --header "Authorization: ${bearer}"`),
      ];
    case "cursor":
      return [
        {
          key: "install",
          // Cursor's install link: base64 of the server object without its name (cursor.com/docs/context/mcp/install-links).
          install: `cursor://anysphere.cursor-deeplink/mcp/install?name=consyrium&config=${encodeURIComponent(btoa(JSON.stringify({ url: mcpUrl })))}`,
          code: { label: "~/.cursor/mcp.json", text: json({ mcpServers: { consyrium: { url: mcpUrl } } }) },
        },
        signIn,
        { key: "ask" },
        tokenAlt("~/.cursor/mcp.json", json({ mcpServers: { consyrium: { url: mcpUrl, headers: { Authorization: bearer } } } })),
      ];
    case "vscode":
      return [
        {
          key: "install",
          // VS Code's install link: the flat server configuration with its name, URL-encoded.
          install: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "consyrium", type: "http", url: mcpUrl }))}`,
          code: { label: ".vscode/mcp.json", text: json({ servers: { consyrium: { type: "http", url: mcpUrl } } }) },
        },
        signIn,
        { key: "ask" },
        tokenAlt(".vscode/mcp.json", json({ servers: { consyrium: { type: "http", url: mcpUrl, headers: { Authorization: bearer } } } })),
      ];
    case "claude-desktop":
      return [{ key: "open" }, { key: "enter", code: { label: "Remote MCP server URL", text: mcpUrl } }, signIn, ask];
    case "chatgpt":
      return [{ key: "open" }, { key: "enter", code: { label: "MCP server URL", text: mcpUrl } }, signIn, { key: "use" }, { key: "plans" }];
    case "codex":
      return [
        { key: "config", code: { label: "~/.codex/config.toml", text: `[mcp_servers.consyrium]\nurl = "${mcpUrl}"` } },
        { key: "login", code: { label: "Terminal", text: "codex mcp login consyrium" } },
        signIn,
        ask,
        tokenAlt("~/.codex/config.toml", `[mcp_servers.consyrium]\nurl = "${mcpUrl}"\nhttp_headers = { "Authorization" = "${bearer}" }`),
      ];
    case "gemini-cli":
      return [
        { key: "config", code: { label: "~/.gemini/settings.json", text: json({ mcpServers: { consyrium: { httpUrl: mcpUrl } } }) } },
        { key: "login", code: { label: "Gemini CLI", text: "/mcp auth consyrium" } },
        signIn,
        ask,
        tokenAlt("~/.gemini/settings.json", json({ mcpServers: { consyrium: { httpUrl: mcpUrl, headers: { Authorization: bearer } } } })),
      ];
    case "hermes":
      return [
        { key: "config", code: { label: "~/.hermes/config.yaml", text: `mcp_servers:\n  consyrium:\n    url: "${mcpUrl}"\n    auth: oauth` } },
        { key: "login", code: { label: "Terminal", text: "hermes mcp login consyrium" } },
        signIn,
        ask,
        tokenAlt("~/.hermes/config.yaml", `mcp_servers:\n  consyrium:\n    url: "${mcpUrl}"\n    headers:\n      Authorization: "${bearer}"`),
      ];
    case "openclaw":
      return [
        { key: "add", code: { label: "Terminal", text: `openclaw mcp add consyrium --url ${mcpUrl} --transport streamable-http --auth oauth` } },
        { key: "login", code: { label: "Terminal", text: "openclaw mcp login consyrium" } },
        signIn,
        ask,
        tokenAlt(
          "Terminal",
          `openclaw mcp set consyrium '${JSON.stringify({ url: mcpUrl, transport: "streamable-http", headers: { Authorization: bearer } })}'`,
        ),
      ];
    case "telegram":
      return [
        { key: "bot", code: { label: "Telegram", text: "@BotFather → /newbot" } },
        { key: "chat" },
        { key: "connect" },
        { key: "allow" },
        { key: "ask", code: { label: "Telegram", text: "/frage PostgreSQL oder SQLite für 50 Nutzer?\n- muss selbst gehostet laufen" } },
      ];
    case "obsidian":
      return [
        { key: "download" },
        { key: "folder", code: { label: "Vault", text: "<vault>/.obsidian/plugins/consyrium/" } },
        { key: "enable" },
        { key: "connect" },
        { key: "use" },
        { key: "mcp", code: { label: "MCP (HTTP)", text: mcpUrl } },
      ];
  }
}
