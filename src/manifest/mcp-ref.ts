/**
 * MCP tool resource refs — `mcp:<server>/<tool>` (capability / Manifest)
 * and `<server>__<tool>` (provider-safe model tool name).
 */

/** Capability / Manifest ref for one declared MCP tool. */
export type McpToolRef = `mcp:${string}/${string}`;

/** Parsed `mcp:<server>/<tool>` ref. */
export interface ParsedMcpToolRef {
  readonly server: string;
  readonly tool: string;
}

/**
 * Build a capability ref.
 *
 * @param server - Declared MCP server name
 * @param tool - Allowlisted tool name on that server
 */
export function mcpToolRef(server: string, tool: string): McpToolRef {
  return `mcp:${server}/${tool}`;
}

/**
 * Parse `mcp:<server>/<tool>`. Null when the prefix or parts are missing.
 *
 * @param ref - Effect / tool resource string
 */
export function parseMcpToolRef(ref: string): ParsedMcpToolRef | null {
  if (!ref.startsWith("mcp:")) return null;
  const rest = ref.slice(4);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { server: rest.slice(0, slash), tool: rest.slice(slash + 1) };
}

/**
 * True when `ref` is a well-formed MCP capability ref.
 *
 * @param ref - Candidate
 */
export function isMcpToolRef(ref: string): boolean {
  return parseMcpToolRef(ref) !== null;
}

/**
 * Graph node id for one MCP server (`mcp:github`).
 *
 * @param server - Declared server name
 */
export function mcpServerNodeId(server: string): string {
  return `mcp:${server}`;
}

/**
 * Provider-safe function name (`github__create_issue`).
 *
 * @param server - Declared server name
 * @param tool - MCP tool name
 */
export function mcpModelToolName(server: string, tool: string): string {
  return `${server}__${tool}`;
}

/**
 * Inverse of {@link mcpModelToolName}.
 *
 * @param name - Model-facing tool name
 */
export function parseMcpModelToolName(name: string): ParsedMcpToolRef | null {
  const sep = name.indexOf("__");
  if (sep <= 0 || sep === name.length - 2) return null;
  return { server: name.slice(0, sep), tool: name.slice(sep + 2) };
}

/**
 * Capability ref from either `mcp:server/tool` or `server__tool`.
 *
 * @param name - Model-facing or capability name
 */
export function mcpCapabilityRefFromName(name: string): McpToolRef | null {
  const fromRef = parseMcpToolRef(name);
  if (fromRef) return mcpToolRef(fromRef.server, fromRef.tool);
  const fromModel = parseMcpModelToolName(name);
  if (fromModel) return mcpToolRef(fromModel.server, fromModel.tool);
  return null;
}
