/**
 * MCP client transport contract — HTTP, stdio, and test mock.
 */

import type { McpRpcError } from "./mcp-protocol.ts";

/** Outbound JSON-RPC request. */
export interface McpTransportRequest {
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** HTTP clients MUST abort fetch / SSE. stdio writes `notifications/cancelled` then kills. */
  readonly cancelMode: "http" | "stdio";
}

/** Wire result (HTTP status present only for Streamable HTTP). */
export interface McpWireResult {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: McpRpcError;
  readonly httpStatus?: number;
  readonly sessionId?: string;
  readonly rawBody?: unknown;
}

/** Bidirectional MCP transport. */
export interface McpTransport {
  readonly kind: "http" | "stdio" | "mock";
  /**
   * Send one JSON-RPC request and wait for the matching response.
   *
   * @param request - Envelope + headers + abort
   */
  request(request: McpTransportRequest): Promise<McpWireResult>;
  /** Release the process / connection. */
  close(): Promise<void>;
}

/**
 * Transport / protocol failure with enough shape for era fallback.
 */
export class McpTransportError extends Error {
  readonly httpStatus?: number;
  readonly rpc?: McpRpcError;
  readonly network?: boolean;
  readonly timeout?: boolean;

  /**
   * @param message - Diagnostic
   * @param extras - HTTP / RPC / network flags
   */
  constructor(
    message: string,
    extras: {
      readonly httpStatus?: number;
      readonly rpc?: McpRpcError;
      readonly network?: boolean;
      readonly timeout?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "McpTransportError";
    if (extras.httpStatus !== undefined) this.httpStatus = extras.httpStatus;
    if (extras.rpc !== undefined) this.rpc = extras.rpc;
    if (extras.network !== undefined) this.network = extras.network;
    if (extras.timeout !== undefined) this.timeout = extras.timeout;
  }
}
