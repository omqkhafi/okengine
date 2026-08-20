/**
 * Read-only docs MCP HTTP server on port 6536.
 *
 * Host/Origin validation uses the shared {@link checkRequestSecurity}
 * validator (same rules as the app MCP on :6535). No Bearer auth — this
 * surface serves public documentation, not a live Manifest.
 */

import {
  checkRequestSecurity,
  forbiddenResponse,
  resolveAllowedHosts,
} from "../runtime/security.ts";
import { DOCS_MCP_PORT, type ServerHandle } from "../runtime/types.ts";
import { asData } from "./data.ts";
import { defaultDocsContentDir, loadDocsIndex, type DocsIndex } from "./docs-index.ts";
import { createDocsToolRuntime } from "./docs-tools.ts";
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
import { newMcpTransportSessionId } from "./session.ts";

/** Options for {@link createDocsMcpServer} / {@link serveDocsMcp}. */
export interface CreateDocsMcpServerOptions {
  /** Preloaded index (tests). When omitted, load from {@link contentDir}. */
  readonly index?: DocsIndex;
  /** Docs content directory. Defaults to `site/content/docs`. */
  readonly contentDir?: string;
  readonly version?: string;
  readonly allowedHosts?: readonly string[];
  readonly hostname?: string;
}

/** In-process docs MCP handler (no listen). */
export interface DocsMcpServer {
  /** Handle one HTTP request. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Bound docs index. */
  readonly index: DocsIndex;
  /** Tool runtime (tests). */
  readonly tools: ReturnType<typeof createDocsToolRuntime>;
}

/**
 * Create a docs MCP request handler without listening.
 *
 * @param options - Index / security options
 */
export async function createDocsMcpServer(
  options: CreateDocsMcpServerOptions = {},
): Promise<DocsMcpServer> {
  const index =
    options.index ?? (await loadDocsIndex(options.contentDir ?? defaultDocsContentDir()));
  const tools = createDocsToolRuntime(index);
  const hostname = options.hostname ?? "127.0.0.1";
  const allowed = resolveAllowedHosts(hostname, options.allowedHosts);
  const version = options.version ?? "0.0.19";
  const transportSessions = new Set<string>();

  const fetch = async (request: Request): Promise<Response> => {
    const security = checkRequestSecurity(request, allowed);
    if (!security.ok) return forbiddenResponse(security.reason);

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, surface: "docs-mcp" });
    }

    if (request.method !== "POST" || url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonRpcHttp(rpcError(null, RpcErrorCode.parse, "invalid JSON body"), 400);
    }

    const parsed = parseJsonRpcRequest(body);
    if (!parsed.ok) {
      return jsonRpcHttp(rpcError(null, RpcErrorCode.invalidRequest, parsed.message), 400);
    }

    const { request: rpc } = parsed;
    const id: JsonRpcId = rpc.id;

    switch (rpc.method) {
      case "initialize": {
        const sessionId = newMcpTransportSessionId();
        transportSessions.add(sessionId);
        const result: McpInitializeResult = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "okengine-docs-mcp", version },
          sessionId,
        };
        return jsonRpcHttp(rpcSuccess(id, result));
      }
      case "ping":
        return jsonRpcHttp(rpcSuccess(id, { ok: true }));
      case "tools/list": {
        const listed = tools.listTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
          },
        }));
        return jsonRpcHttp(
          rpcSuccess(id, {
            tools: listed,
            _oke: asData({ count: listed.length }, "catalog"),
          }),
        );
      }
      case "tools/call": {
        const call = parseToolsCallParams(rpc.params);
        if (!call.ok) {
          return jsonRpcHttp(rpcError(id, RpcErrorCode.invalidParams, call.message), 400);
        }
        const result = tools.callTool(call.name, call.arguments);
        if (!result.ok) {
          const code =
            result.code === "not-found" ? RpcErrorCode.methodNotFound : RpcErrorCode.invalidParams;
          return jsonRpcHttp(
            rpcError(id, code, result.message, result.data),
            result.code === "not-found" ? 404 : 400,
          );
        }
        return jsonRpcHttp(
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
        );
      }
      default:
        return jsonRpcHttp(
          rpcError(id, RpcErrorCode.methodNotFound, `method not found: ${rpc.method}`),
          404,
        );
    }
  };

  return { fetch, index, tools };
}

/** Options for {@link serveDocsMcp}. */
export interface ServeDocsMcpOptions extends CreateDocsMcpServerOptions {
  readonly port?: number;
}

/** Running docs MCP server handle. */
export interface DocsMcpServerHandle extends ServerHandle {
  readonly mcp: DocsMcpServer;
}

/**
 * Listen on port 6536 (or override) with Host/Origin validation.
 *
 * @param options - Server options
 */
export async function serveDocsMcp(
  options: ServeDocsMcpOptions = {},
): Promise<DocsMcpServerHandle> {
  const hostname = options.hostname ?? "127.0.0.1";
  const port = options.port ?? DOCS_MCP_PORT;
  const mcp = await createDocsMcpServer({ ...options, hostname });
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
