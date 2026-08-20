/**
 * In-process MCP transport for tests — no child process, no network.
 */

import { abortError, abortableSleep } from "../../kernel/abort-scope.ts";
import type { McpListedTool, McpRpcError } from "./mcp-protocol.ts";
import {
  type McpTransport,
  type McpTransportRequest,
  type McpWireResult,
} from "./mcp-transport.ts";

/** One tool the mock server exposes. */
export interface MockMcpTool extends McpListedTool {}

/** Options for {@link createMockMcpTransport}. */
export interface CreateMockMcpTransportOptions {
  readonly era?: "modern" | "legacy";
  readonly tools?: readonly MockMcpTool[];
  /** HTTP status of the first request (default 200). */
  readonly httpStatusOnFirst?: number;
  /** JSON-RPC error on the first request. */
  readonly firstError?: McpRpcError;
  /** Unrecognized first-request body (400 without a modern error object). */
  readonly firstBody?: unknown;
  readonly onCall?: (name: string, args: unknown, signal?: AbortSignal) => unknown;
  readonly delayMs?: number;
  /** `server/discover` hangs until abort / never resolves. */
  readonly discoverHang?: boolean;
  readonly extraTools?: readonly MockMcpTool[];
}

/**
 * Create a mock MCP transport.
 *
 * @param options - Era / tools / first-request fault
 */
export function createMockMcpTransport(options: CreateMockMcpTransportOptions = {}): McpTransport {
  let requestCount = 0;
  const era = options.era ?? "modern";
  const tools = [...(options.tools ?? []), ...(options.extraTools ?? [])];

  return {
    kind: "mock",
    async request(request: McpTransportRequest): Promise<McpWireResult> {
      if (request.signal?.aborted) throw abortError(request.signal.reason);
      requestCount += 1;
      if (options.delayMs) {
        await abortableSleep(options.delayMs, request.signal);
      }
      if (options.discoverHang && request.method === "server/discover") {
        await hangUntilAbort(request.signal);
      }

      if (requestCount === 1 && options.httpStatusOnFirst !== undefined) {
        if (options.firstError) {
          return {
            ok: false,
            error: options.firstError,
            httpStatus: options.httpStatusOnFirst,
            rawBody: { jsonrpc: "2.0", id: request.id, error: options.firstError },
          };
        }
        return {
          ok: false,
          httpStatus: options.httpStatusOnFirst,
          rawBody: options.firstBody,
        };
      }

      if (request.method === "initialize") {
        if (era === "modern") {
          return {
            ok: false,
            error: { code: -32022, message: "UnsupportedProtocolVersion" },
            httpStatus: 400,
          };
        }
        return {
          ok: true,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "mock", version: "0" },
          },
          httpStatus: 200,
          sessionId: "mock-session",
        };
      }

      if (request.method === "server/discover" || request.method === "tools/list") {
        return {
          ok: true,
          result: { tools },
          httpStatus: 200,
        };
      }

      if (request.method === "tools/call") {
        const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
        const name = typeof params?.name === "string" ? params.name : "";
        const output = options.onCall
          ? await Promise.resolve(options.onCall(name, params?.arguments ?? {}, request.signal))
          : { content: [{ type: "text", text: `ok:${name}` }] };
        return { ok: true, result: output, httpStatus: 200 };
      }

      return {
        ok: false,
        error: { code: -32601, message: `method not found: ${request.method}` },
        httpStatus: 200,
      };
    },
    async close() {
      /* mock */
    },
  };
}

function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(abortError(signal.reason));
      },
      { once: true },
    );
  });
}
