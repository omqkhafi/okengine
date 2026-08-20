/**
 * MCP HTTP server on port 6535.
 *
 * Host/Origin validation uses the shared {@link checkRequestSecurity}
 * validator (same rules as Console's {@link secureFetch} — port differs,
 * allow-list logic does not). Authentication is required even on localhost.
 * The caller's token is never forwarded to Console or upstream services —
 * adapters receive structured operator ids.
 */

import { logDevRequest, shouldLogDevRequests } from "../runtime/dev-request-log.ts";
import {
  checkRequestSecurity,
  forbiddenResponse,
  resolveAllowedHosts,
} from "../runtime/security.ts";
import { MCP_PORT, type ServerHandle } from "../runtime/types.ts";
import { SessionError, type SessionStore } from "../auth/sessions.ts";
import { asData } from "./data.ts";
import {
  MCP_PROTOCOL_VERSION,
  parseJsonRpcRequest,
  parseToolsCallParams,
  rpcError,
  rpcSuccess,
  RpcErrorCode,
  type JsonRpcId,
  type McpInitializeResult,
} from "./protocol.ts";
import { authenticateMcpRequest, extractBearer, newMcpTransportSessionId } from "./session.ts";
import { createToolRuntime, type McpContext } from "./tools.ts";

/** Options for {@link createMcpServer} / {@link serveMcp}. */
export interface CreateMcpServerOptions {
  readonly sessions: SessionStore;
  readonly secret: string;
  readonly context: McpContext;
  readonly now?: () => number;
  readonly version?: string;
  readonly allowedHosts?: readonly string[];
  readonly hostname?: string;
}

/** In-process MCP handler (no listen). */
export interface McpServer {
  /** Handle one HTTP request. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Tool runtime (tests). */
  readonly tools: ReturnType<typeof createToolRuntime>;
}

/**
 * Create an MCP request handler without listening.
 *
 * @param options - Sessions, secret, context
 */
export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const now = options.now ?? (() => Date.now());
  const tools = createToolRuntime(options.context);
  const hostname = options.hostname ?? "127.0.0.1";
  const allowed = resolveAllowedHosts(hostname, options.allowedHosts);
  const version = options.version ?? "0.0.19";
  /** Transport session ids issued at initialize — crypto-random. */
  const transportSessions = new Set<string>();

  const fetch = async (request: Request): Promise<Response> => {
    const started = performance.now();
    let flowLabel: string | undefined;
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    const respond = (response: Response): Response => {
      if (shouldLogDevRequests()) {
        logDevRequest({
          surface: "MCP",
          method,
          path: url.pathname,
          flow: flowLabel,
          status: response.status,
          ms: Math.round(performance.now() - started),
        });
      }
      return response;
    };

    const security = checkRequestSecurity(request, allowed);
    if (!security.ok) return respond(forbiddenResponse(security.reason));

    if (method === "GET" && url.pathname === "/health") {
      return respond(Response.json({ ok: true, surface: "mcp" }));
    }

    if (method !== "POST" || url.pathname !== "/mcp") {
      return respond(new Response("Not Found", { status: 404 }));
    }

    const bearer = extractBearer(request.headers.get("authorization"));
    if (bearer === null) {
      return respond(
        jsonRpcHttp(
          rpcError(
            null,
            RpcErrorCode.unauthorized,
            "Bearer token required",
            asData({ reason: "missing-token" }, "error"),
          ),
          401,
        ),
      );
    }

    let requester;
    try {
      requester = await authenticateMcpRequest(options.sessions, options.secret, bearer, now);
    } catch (err) {
      const message = err instanceof SessionError ? err.message : "authentication failed";
      return respond(
        jsonRpcHttp(
          rpcError(
            null,
            RpcErrorCode.unauthorized,
            message,
            asData({ reason: "auth-failed", message }, "error"),
          ),
          401,
        ),
      );
    }

    // Never attach the Bearer token to any outbound call — adapters below
    // receive only structured fields from `requester`.
    void bearer;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return respond(jsonRpcHttp(rpcError(null, RpcErrorCode.parse, "invalid JSON body"), 400));
    }

    const parsed = parseJsonRpcRequest(body);
    if (!parsed.ok) {
      return respond(jsonRpcHttp(rpcError(null, RpcErrorCode.invalidRequest, parsed.message), 400));
    }

    const { request: rpc } = parsed;
    const id: JsonRpcId = rpc.id;
    flowLabel = rpc.method;

    switch (rpc.method) {
      case "initialize": {
        const sessionId = newMcpTransportSessionId();
        transportSessions.add(sessionId);
        const result: McpInitializeResult = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "okengine-mcp", version },
          sessionId,
        };
        return respond(jsonRpcHttp(rpcSuccess(id, result)));
      }
      case "ping":
        return respond(jsonRpcHttp(rpcSuccess(id, { ok: true })));
      case "tools/list": {
        const listed = tools.listTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: t.mutability === "read",
            destructiveHint: t.mutability === "write",
          },
        }));
        return respond(
          jsonRpcHttp(
            rpcSuccess(id, {
              tools: listed,
              // Catalogue itself is data.
              _oke: asData({ count: listed.length }, "catalog"),
            }),
          ),
        );
      }
      case "tools/call": {
        const call = parseToolsCallParams(rpc.params);
        if (!call.ok) {
          return respond(jsonRpcHttp(rpcError(id, RpcErrorCode.invalidParams, call.message), 400));
        }
        flowLabel = call.name;
        const result = await tools.callTool(requester, call.name, call.arguments);
        if (!result.ok) {
          const code =
            result.code === "unauthorized"
              ? RpcErrorCode.unauthorized
              : result.code === "forbidden"
                ? RpcErrorCode.forbidden
                : result.code === "not-found"
                  ? RpcErrorCode.methodNotFound
                  : RpcErrorCode.invalidParams;
          return respond(
            jsonRpcHttp(
              rpcError(id, code, result.message, result.data),
              result.code === "unauthorized" ? 401 : 403,
            ),
          );
        }
        // MCP content blocks: text carries JSON of the inert envelope.
        // Agents must treat it as data (envelope.kind === "data").
        return respond(
          jsonRpcHttp(
            rpcSuccess(id, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result.data),
                },
              ],
              structuredContent: result.data,
              isError: false,
            }),
          ),
        );
      }
      default:
        return respond(
          jsonRpcHttp(
            rpcError(id, RpcErrorCode.methodNotFound, `method not found: ${rpc.method}`),
            404,
          ),
        );
    }
  };

  return { fetch, tools };
}

/** Options for {@link serveMcp}. */
export interface ServeMcpOptions extends CreateMcpServerOptions {
  readonly port?: number;
}

/** Running MCP server handle. */
export interface McpServerHandle extends ServerHandle {
  readonly mcp: McpServer;
}

/**
 * Listen on port 6535 (or override) with Host/Origin validation.
 *
 * @param options - Server options
 */
export async function serveMcp(options: ServeMcpOptions): Promise<McpServerHandle> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? MCP_PORT;
  const mcp = createMcpServer({ ...options, hostname });
  const server = Bun.serve({
    hostname,
    port,
    fetch: mcp.fetch,
  });
  const boundPort = server.port ?? port;
  const boundHost = hostname;
  const url = new URL(`http://${boundHost}:${boundPort}/`);
  return {
    mcp,
    url,
    port: boundPort,
    hostname: boundHost,
    fetch: mcp.fetch,
    stop(closeActive = false) {
      return server.stop(closeActive);
    },
  };
}

function jsonRpcHttp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
