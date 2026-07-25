/**
 * Minimal MCP JSON-RPC 2.0 envelope — no SDK dependency.
 *
 * We implement only what agents need: initialize, tools/list, tools/call,
 * and ping. Strict unknown-first parsing rejects poisoned shapes early.
 */

/** JSON-RPC request id. */
export type JsonRpcId = string | number | null;

/** Parsed JSON-RPC request. */
export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

/** JSON-RPC success response. */
export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

/** JSON-RPC error response. */
export interface JsonRpcError {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/** Standard JSON-RPC error codes (+ MCP auth extensions). */
export const RpcErrorCode = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Unauthorized / wrong audience / revoked session. */
  unauthorized: -32001,
  /** Tool denied by ACL or missing confirmation. */
  forbidden: -32003,
} as const;

/**
 * Parse a JSON-RPC request from an unknown body.
 *
 * @param body - Decoded JSON
 */
export function parseJsonRpcRequest(
  body: unknown,
):
  | { readonly ok: true; readonly request: JsonRpcRequest }
  | { readonly ok: false; readonly message: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "request must be a JSON object" };
  }
  const o = body as Record<string, unknown>;
  if (o.jsonrpc !== "2.0") {
    return { ok: false, message: "jsonrpc must be \"2.0\"" };
  }
  if (typeof o.method !== "string" || o.method.length === 0) {
    return { ok: false, message: "method must be a non-empty string" };
  }
  const id = o.id;
  if (
    id !== null &&
    id !== undefined &&
    typeof id !== "string" &&
    typeof id !== "number"
  ) {
    return { ok: false, message: "id must be string, number, or null" };
  }
  return {
    ok: true,
    request: {
      jsonrpc: "2.0",
      id: (id ?? null) as JsonRpcId,
      method: o.method,
      params: o.params,
    },
  };
}

/**
 * Build a JSON-RPC success response.
 *
 * @param id - Request id
 * @param result - Result payload
 */
export function rpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Build a JSON-RPC error response. `data` is always wrapped by the caller
 * as inert MCP data when it carries untrusted content.
 *
 * @param id - Request id
 * @param code - Error code
 * @param message - Safe diagnostic (never attacker-controlled instructions)
 * @param data - Optional structured data
 */
export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** MCP initialize result shape. */
export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: {
    readonly tools: { readonly listChanged: false };
  };
  readonly serverInfo: {
    readonly name: "okengine-mcp";
    readonly version: string;
  };
  /** Cryptographically random transport session id. */
  readonly sessionId: string;
}

/** Supported MCP protocol version. */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/**
 * Parse tools/call params.
 *
 * @param params - Unknown params
 */
export function parseToolsCallParams(
  params: unknown,
):
  | {
      readonly ok: true;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly ok: false; readonly message: string } {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return { ok: false, message: "params must be an object" };
  }
  const o = params as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0) {
    return { ok: false, message: "params.name must be a non-empty string" };
  }
  const args = o.arguments;
  if (args === undefined) {
    return { ok: true, name: o.name, arguments: {} };
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, message: "params.arguments must be an object" };
  }
  return {
    ok: true,
    name: o.name,
    arguments: args as Record<string, unknown>,
  };
}
