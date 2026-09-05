/**
 * Streamable HTTP MCP transport — POST JSON-RPC, optional SSE response.
 *
 * Cancel = abort `fetch` / close the SSE stream. Never POST
 * `notifications/cancelled` on HTTP.
 */

import { abortError } from "../../kernel/abort-scope.ts";
import { parseJsonRpcResponse } from "./mcp-protocol.ts";
import {
  McpTransportError,
  type McpTransport,
  type McpTransportRequest,
  type McpWireResult,
} from "./mcp-transport.ts";

/** Options for {@link createMcpHttpTransport}. */
export interface CreateMcpHttpTransportOptions {
  readonly url: string;
  readonly bearer?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Create a Streamable HTTP transport for one MCP origin.
 *
 * @param options - URL + optional bearer
 */
export function createMcpHttpTransport(options: CreateMcpHttpTransportOptions): McpTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    kind: "http",
    async request(request: McpTransportRequest): Promise<McpWireResult> {
      if (request.signal?.aborted) throw abortError(request.signal.reason);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...request.headers,
      };
      if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        method: request.method,
        ...(request.params !== undefined ? { params: request.params } : {}),
      });
      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: "POST",
          headers,
          body,
          signal: request.signal,
        });
      } catch (err) {
        if (request.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
          throw abortError(request.signal?.reason ?? err);
        }
        throw new McpTransportError(
          err instanceof Error ? err.message : "ai.mcp: HTTP request failed",
          { network: true },
        );
      }

      const sessionId = response.headers.get("mcp-session-id") ?? undefined;
      const ctype = response.headers.get("content-type") ?? "";
      const rawBody = ctype.includes("text/event-stream")
        ? await readSseJsonRpc(response, request.id, request.signal)
        : await readJsonBody(response);

      const parsed = parseJsonRpcResponse(rawBody);
      if (parsed?.ok) {
        return {
          ok: true,
          result: parsed.result,
          httpStatus: response.status,
          ...(sessionId !== undefined ? { sessionId } : {}),
          rawBody,
        };
      }
      if (parsed && !parsed.ok) {
        return {
          ok: false,
          error: parsed.error,
          httpStatus: response.status,
          ...(sessionId !== undefined ? { sessionId } : {}),
          rawBody,
        };
      }
      return {
        ok: false,
        httpStatus: response.status,
        ...(sessionId !== undefined ? { sessionId } : {}),
        rawBody,
      };
    },
    async close() {
      /* HTTP is per-request */
    },
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function readSseJsonRpc(
  response: Response,
  id: string | number,
  signal?: AbortSignal,
): Promise<unknown> {
  let buf = "";
  let last: unknown;
  for await (const piece of responseTextStream(response)) {
    if (signal?.aborted) throw abortError(signal.reason);
    buf += piece;
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const json: unknown = JSON.parse(data);
        if (
          json !== null &&
          typeof json === "object" &&
          !Array.isArray(json) &&
          (json as { id?: unknown }).id === id
        ) {
          last = json;
        }
      } catch {
        /* skip malformed frames */
      }
    }
  }
  if (last === undefined) {
    throw new Error("ai.mcp: SSE stream ended without a matching response");
  }
  return last;
}

function responseTextStream(res: Response): AsyncIterable<string> {
  const stream = (res as Response & { textStream?: () => AsyncIterable<string> }).textStream;
  if (typeof stream !== "function") {
    throw new Error("ai.mcp: Response.textStream is required (Bun >= 1.4.2)");
  }
  return stream.call(res);
}
