import "server-only";

/**
 * Minimal MCP server (Model Context Protocol, Streamable HTTP transport, stateless): JSON-RPC 2.0 over POST, answered
 * with application/json. Supports initialize, ping, tools/list and tools/call – enough for Claude Code, Claude Desktop,
 * Cursor and VS Code. No sessions, no server-initiated messages, no resources/prompts. Auth and plan checks happen in
 * the route; this module only speaks the protocol.
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SERVER_INFO = { name: "consyrion", title: "CONSYRION AI", version: "1.0.0" };

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Changes data or costs tokens on the user's key: hidden from read-only tokens, marked for the client's approval. */
  write: boolean;
  run(args: Record<string, unknown>): Promise<unknown>;
}

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: Record<string, unknown>;
}

const error = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });
const result = (id: JsonRpcId, value: unknown) => ({ jsonrpc: "2.0" as const, id, result: value });

/** Handles one JSON-RPC message; returns null for notifications (no id), which get no answer. */
export async function handleMcpMessage(message: JsonRpcRequest, tools: McpTool[]): Promise<object | null> {
  const id = message.id ?? null;
  const isNotification = message.id === undefined;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return isNotification ? null : error(id, -32600, "Invalid request");
  if (isNotification) return null; // notifications/initialized, notifications/cancelled …

  switch (message.method) {
    case "initialize": {
      const requested = typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "CONSYRION AI runs multi-model councils that reach a documented verdict. When the user faces a decision while working, use ask_consyrion " +
          "(one call: question, context, options, requirements – show the user requirements and budget first), then get_decision. Read projects and decisions, prepare projects and requirements, " +
          "and start councils on the user's own API keys (costs tokens – always tell the user the budget first). Approving, rejecting, building " +
          "and deleting are human steps in the web app and not available here; give the user the link instead.",
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: t.name === "start_council" },
        })),
      });
    case "tools/call": {
      const name = typeof message.params?.name === "string" ? message.params.name : "";
      const tool = tools.find((t) => t.name === name);
      if (!tool) return error(id, -32602, `Unknown tool: ${name}`);
      const args = message.params?.arguments && typeof message.params.arguments === "object" ? (message.params.arguments as Record<string, unknown>) : {};
      try {
        const data = await tool.run(args);
        const structured = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { value: data };
        return result(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: structured, isError: false });
      } catch (err) {
        // Tool errors go back to the model as a result (it can react); only the message, never internals.
        const text = err instanceof Error && "code" in err ? err.message : "The tool failed";
        return result(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return error(id, -32601, `Method not found: ${message.method}`);
  }
}
