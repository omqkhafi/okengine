/**
 * MCP client protocol — 2026-07-28 happy path + dual-era fallback types.
 *
 * Reuses only the JSON-RPC envelope. Does not import the app MCP *server*
 * dialect (`2024-11-05` initialize) as the client version.
 */

/** Current MCP protocol version (stateless core). */
export const MCP_CLIENT_PROTOCOL_VERSION = "2026-07-28";

/** Legacy initialize dialect still in production. */
export const MCP_LEGACY_PROTOCOL_VERSION = "2024-11-05";

/** JSON-RPC request id. */
export type JsonRpcId = string | number;

/** Modern protocol era vs initialize handshake. */
export type McpProtocolEra = "modern" | "legacy";

/** JSON-RPC error object. */
export interface McpRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** Modern MCP error codes that are *not* a cue to `initialize`. */
export const McpModernErrorCode = {
  headerMismatch: -32020,
  missingRequiredClientCapability: -32021,
  unsupportedProtocolVersion: -32022,
  /** Resource not found — remapped to invalid params; not version negotiation. */
  resourceNotFound: -32002,
} as const;

/** Per-request `_meta` for the 2026-07-28 stateless core. */
export interface McpClientMeta {
  readonly "io.modelcontextprotocol/protocolVersion": typeof MCP_CLIENT_PROTOCOL_VERSION;
  readonly clientCapabilities: {
    readonly extensions: Readonly<Record<string, never>>;
  };
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
}

/** Tool listed by `tools/list`. */
export interface McpListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
}

/** Parsed JSON-RPC success or error. */
export type ParsedJsonRpcResponse =
  | { readonly ok: true; readonly id: JsonRpcId | null; readonly result: unknown }
  | { readonly ok: false; readonly id: JsonRpcId | null; readonly error: McpRpcError };

/**
 * Build the required per-request `_meta` bag.
 *
 * @param version - Client package version
 */
export function mcpClientMeta(version: string): McpClientMeta {
  return {
    "io.modelcontextprotocol/protocolVersion": MCP_CLIENT_PROTOCOL_VERSION,
    clientCapabilities: { extensions: {} },
    clientInfo: { name: "okengine", version },
  };
}

/**
 * True when a 400 JSON-RPC error is a modern protocol reject (do not initialize).
 *
 * @param code - JSON-RPC error code
 */
export function isModernProtocolReject(code: number): boolean {
  return (
    code === McpModernErrorCode.unsupportedProtocolVersion ||
    code === McpModernErrorCode.headerMismatch ||
    code === McpModernErrorCode.missingRequiredClientCapability
  );
}

/**
 * Parse a JSON-RPC 2.0 response object.
 *
 * @param body - Decoded JSON
 */
export function parseJsonRpcResponse(body: unknown): ParsedJsonRpcResponse | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if (o.jsonrpc !== "2.0") return null;
  const id = o.id;
  if (id !== null && id !== undefined && typeof id !== "string" && typeof id !== "number") {
    return null;
  }
  const rid = (id ?? null) as JsonRpcId | null;
  if ("error" in o) {
    const err = o.error;
    if (err === null || typeof err !== "object" || Array.isArray(err)) return null;
    const e = err as Record<string, unknown>;
    if (typeof e.code !== "number" || typeof e.message !== "string") return null;
    return {
      ok: false,
      id: rid,
      error: {
        code: e.code,
        message: e.message,
        ...(e.data !== undefined ? { data: e.data } : {}),
      },
    };
  }
  if (!("result" in o)) return null;
  return { ok: true, id: rid, result: o.result };
}

/**
 * Parse `tools/list` result.tools.
 *
 * @param result - RPC result
 */
export function parseToolsListResult(result: unknown): McpListedTool[] {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return [];
  const tools = (result as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return [];
  const out: McpListedTool[] = [];
  for (const raw of tools) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.name !== "string" || t.name.length === 0) continue;
    out.push({
      name: t.name,
      ...(typeof t.description === "string" ? { description: t.description } : {}),
      ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
      ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
    });
  }
  return out;
}

/**
 * Interpret `tools/call` result. Missing `resultType` means `"complete"`.
 *
 * @param result - RPC result
 */
export function interpretToolsCallResult(result: unknown): unknown {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const o = result as Record<string, unknown>;
  const resultType = o.resultType;
  if (resultType === undefined || resultType === "complete") return result;
  if (resultType === "input_required") {
    throw new Error("ai.mcp: tool returned input_required (HITL is not supported)");
  }
  const label = typeof resultType === "string" ? resultType : JSON.stringify(resultType);
  throw new Error(`ai.mcp: unrecognized resultType "${label}"`);
}

/**
 * Valid HTTP header token (RFC 9110).
 *
 * @param name - Candidate header name
 */
export function isHttpHeaderToken(name: string): boolean {
  return name.length > 0 && /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name);
}

/**
 * Collect `x-mcp-header` params → `Mcp-Param-*` headers.
 * Returns null when a declared header name is invalid (caller drops the tool).
 *
 * @param inputSchema - Tool JSON schema
 * @param args - Call arguments
 */
export function mcpParamHeaders(
  inputSchema: unknown,
  args: Record<string, unknown>,
): { readonly headers: Record<string, string>; readonly body: Record<string, unknown> } | null {
  const props = schemaProperties(inputSchema);
  if (!props) return { headers: {}, body: { ...args } };
  const headers: Record<string, string> = {};
  const body: Record<string, unknown> = { ...args };
  for (const [key, schema] of Object.entries(props)) {
    const header = headerNameFromSchema(key, schema);
    if (header === undefined) continue;
    if (header === null) return null;
    const value = args[key];
    if (value === undefined) continue;
    headers[header] = typeof value === "string" ? value : JSON.stringify(value);
    delete body[key];
  }
  return { headers, body };
}

/**
 * True when the tool's `x-mcp-header` annotations are all valid.
 *
 * @param inputSchema - Tool JSON schema
 */
export function mcpHeaderAnnotationsValid(inputSchema: unknown): boolean {
  return mcpParamHeaders(inputSchema, {}) !== null;
}

function schemaProperties(
  inputSchema: unknown,
): Record<string, unknown> | undefined {
  if (inputSchema === null || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return undefined;
  }
  const props = (inputSchema as Record<string, unknown>).properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) return undefined;
  return props as Record<string, unknown>;
}

function headerNameFromSchema(key: string, schema: unknown): string | null | undefined {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const raw = (schema as Record<string, unknown>)["x-mcp-header"];
  if (raw === undefined || raw === false) return undefined;
  const name =
    raw === true
      ? `Mcp-Param-${key
          .split(/[-_]/)
          .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : ""))
          .join("")}`
      : typeof raw === "string"
        ? raw
        : null;
  if (name === null || !isHttpHeaderToken(name) || !name.toLowerCase().startsWith("mcp-param-")) {
    return null;
  }
  return name;
}
