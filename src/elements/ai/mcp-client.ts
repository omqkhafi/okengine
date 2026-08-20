/**
 * MCP client session — modern `_meta` first, dual-era fallback, allowlist filter.
 */

import type { AiMcpServerDecl } from "./declare.ts";
import { parseMcpToolRef, type ParsedMcpToolRef } from "../../manifest/mcp-ref.ts";
import { createMcpHttpTransport } from "./mcp-http.ts";
import { createMcpStdioTransport } from "./mcp-stdio.ts";
import {
  interpretToolsCallResult,
  isModernProtocolReject,
  MCP_CLIENT_PROTOCOL_VERSION,
  MCP_LEGACY_PROTOCOL_VERSION,
  mcpClientMeta,
  mcpHeaderAnnotationsValid,
  mcpParamHeaders,
  parseToolsListResult,
  type McpClientMeta,
  type McpListedTool,
  type McpProtocolEra,
} from "./mcp-protocol.ts";
import {
  McpTransportError,
  type McpTransport,
  type McpWireResult,
} from "./mcp-transport.ts";

/** Options for {@link createMcpClient}. */
export interface CreateMcpClientOptions {
  readonly servers?: readonly AiMcpServerDecl[];
  readonly resolveSecret?: (name: string) => string | Promise<string>;
  readonly transports?: Readonly<Record<string, McpTransport>>;
  readonly clientVersion?: string;
}

/** Allowlisted tool + cached schema. */
export interface McpResolvedTool {
  readonly server: string;
  readonly tool: string;
  readonly ref: string;
  readonly listed?: McpListedTool;
}

/** MCP client used by the AI runtime. */
export interface McpClient {
  readonly servers: ReadonlyMap<string, AiMcpServerDecl>;
  listedTool(ref: ParsedMcpToolRef, signal?: AbortSignal): Promise<McpListedTool | undefined>;
  call(ref: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

interface ServerSession {
  readonly decl: AiMcpServerDecl;
  readonly transport: McpTransport;
  readonly eraKey: string;
  readonly cancelMode: "http" | "stdio";
  era?: McpProtocolEra;
  sessionId?: string;
  listed?: readonly McpListedTool[];
}

/**
 * Create an MCP client for declared servers.
 *
 * @param options - Decls + optional injected transports (tests)
 */
export function createMcpClient(options: CreateMcpClientOptions = {}): McpClient {
  const meta = mcpClientMeta(options.clientVersion ?? process.env.npm_package_version ?? "0.0.0");
  const servers = new Map<string, AiMcpServerDecl>();
  for (const decl of options.servers ?? []) servers.set(decl.name, decl);
  const sessions = new Map<string, ServerSession>();
  const eraByKey = new Map<string, McpProtocolEra>();
  let nextId = 1;

  function sessionFor(decl: AiMcpServerDecl): ServerSession {
    const existing = sessions.get(decl.name);
    if (existing) return existing;
    const injected = options.transports?.[decl.name];
    const transport = injected ?? transportFor(decl, options.resolveSecret);
    const eraKey = decl.url ? httpOrigin(decl.url) : `stdio:${decl.command}:${(decl.args ?? []).join("\0")}`;
    const session: ServerSession = {
      decl,
      transport,
      eraKey,
      cancelMode: decl.url ? "http" : "stdio",
      era: eraByKey.get(eraKey),
    };
    sessions.set(decl.name, session);
    return session;
  }

  async function rpc(
    session: ServerSession,
    method: string,
    params: unknown,
    signal: AbortSignal | undefined,
    extra: { readonly toolName?: string; readonly extraHeaders?: Record<string, string> } = {},
  ): Promise<unknown> {
    const id = nextId++;
    const era = session.era ?? "modern";
    const headers = requestHeaders(method, era, session.sessionId, extra.toolName, extra.extraHeaders);
    const wireParams = era === "modern" ? withMeta(params, meta) : params;
    const result = await session.transport.request({
      id,
      method,
      ...(wireParams !== undefined ? { params: wireParams } : {}),
      headers,
      ...(signal !== undefined ? { signal } : {}),
      cancelMode: session.cancelMode,
    });
    if (result.sessionId) session.sessionId = result.sessionId;
    return result;
  }

  async function ensureEra(session: ServerSession, signal?: AbortSignal): Promise<void> {
    if (session.era) return;
    const cached = eraByKey.get(session.eraKey);
    if (cached) {
      session.era = cached;
      if (cached === "legacy") await initializeLegacy(session, signal);
      return;
    }

    const probeMethod = session.cancelMode === "stdio" ? "server/discover" : "tools/list";
    const probeSignal =
      session.cancelMode === "stdio" ? withTimeout(signal, 2_000) : signal;
    let first: McpWireResult;
    try {
      first = (await rpc(session, probeMethod, {}, probeSignal)) as McpWireResult;
    } catch (err) {
      if (session.cancelMode === "stdio") {
        setEra(session, "legacy");
        await initializeLegacy(session, signal);
        return;
      }
      throw err;
    }
    if (first.ok) {
      setEra(session, "modern");
      if (probeMethod === "tools/list") {
        session.listed = filterAllowlist(session.decl, parseToolsListResult(first.result));
      }
      return;
    }

    const decision = classifyFirstError(first, session.cancelMode);
    if (decision === "modern") {
      setEra(session, "modern");
      throw rpcFailure(first, probeMethod);
    }
    if (decision === "fail") {
      throw rpcFailure(first, probeMethod);
    }

    setEra(session, "legacy");
    await initializeLegacy(session, signal);
  }

  async function initializeLegacy(session: ServerSession, signal?: AbortSignal): Promise<void> {
    const result = (await rpc(
      session,
      "initialize",
      {
        protocolVersion: MCP_LEGACY_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: meta.clientInfo,
      },
      signal,
    )) as McpWireResult;
    if (!result.ok) throw rpcFailure(result, "initialize");
    if (result.sessionId) session.sessionId = result.sessionId;
    // `initialized` notification is optional; HTTP clients do not need it.
  }

  function setEra(session: ServerSession, era: McpProtocolEra): void {
    session.era = era;
    eraByKey.set(session.eraKey, era);
  }

  async function listTools(session: ServerSession, signal?: AbortSignal): Promise<readonly McpListedTool[]> {
    if (session.listed) return session.listed;
    await ensureEra(session, signal);
    if (session.listed) return session.listed;
    const result = (await rpc(session, "tools/list", {}, signal)) as McpWireResult;
    if (!result.ok) throw rpcFailure(result, "tools/list");
    session.listed = filterAllowlist(session.decl, parseToolsListResult(result.result));
    return session.listed;
  }

  return {
    servers,
    async listedTool(ref, signal) {
      const decl = servers.get(ref.server);
      if (!decl) return undefined;
      const listed = await listTools(sessionFor(decl), signal);
      return listed.find((t) => t.name === ref.tool);
    },
    async call(ref, input, signal) {
      const parsed = parseMcpToolRef(ref);
      if (!parsed) throw new Error(`ai.mcp: invalid tool ref "${ref}"`);
      const decl = servers.get(parsed.server);
      if (!decl) throw new Error(`ai.mcp: unknown server "${parsed.server}"`);
      if (!decl.tools.includes(parsed.tool)) {
        throw new Error(`ai.mcp: tool "${parsed.tool}" is not allowlisted on "${parsed.server}"`);
      }
      const session = sessionFor(decl);
      await ensureEra(session, signal);
      const listed = await listTools(session, signal);
      const tool = listed.find((t) => t.name === parsed.tool);
      const args = input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
      const split = mcpParamHeaders(tool?.inputSchema, args);
      if (split === null) {
        throw new Error(`ai.mcp: tool "${parsed.tool}" has an invalid x-mcp-header annotation`);
      }
      const result = (await rpc(session, "tools/call", {
        name: parsed.tool,
        arguments: split.body,
      }, signal, {
        toolName: parsed.tool,
        extraHeaders: split.headers,
      })) as McpWireResult;
      if (!result.ok) throw rpcFailure(result, "tools/call");
      return interpretToolsCallResult(result.result);
    },
    async close() {
      await Promise.all([...sessions.values()].map((s) => s.transport.close()));
      sessions.clear();
    },
  };
}

function transportFor(
  decl: AiMcpServerDecl,
  resolveSecret?: (name: string) => string | Promise<string>,
): McpTransport {
  if (decl.url) {
    return {
      kind: "http",
      async request(request) {
        const bearer = decl.auth && resolveSecret ? await resolveSecret(decl.auth) : undefined;
        const inner = createMcpHttpTransport({
          url: decl.url!,
          ...(bearer !== undefined ? { bearer } : {}),
        });
        return inner.request(request);
      },
      async close() {
        /* per-request */
      },
    };
  }
  return createMcpStdioTransport({
    command: decl.command!,
    ...(decl.args !== undefined ? { args: decl.args } : {}),
  });
}

function withMeta(params: unknown, meta: McpClientMeta): unknown {
  const base =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  return { ...base, _meta: meta };
}

function requestHeaders(
  method: string,
  era: McpProtocolEra,
  sessionId: string | undefined,
  toolName: string | undefined,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "MCP-Protocol-Version":
      era === "modern" ? MCP_CLIENT_PROTOCOL_VERSION : MCP_LEGACY_PROTOCOL_VERSION,
    "Mcp-Method": method,
    ...extra,
  };
  if (method === "tools/call" && toolName) headers["Mcp-Name"] = toolName;
  if (era === "legacy" && sessionId) headers["Mcp-Session-Id"] = sessionId;
  return headers;
}

function filterAllowlist(decl: AiMcpServerDecl, listed: McpListedTool[]): McpListedTool[] {
  const allow = new Set(decl.tools);
  return listed.filter(
    (t) => allow.has(t.name) && mcpHeaderAnnotationsValid(t.inputSchema),
  );
}

function classifyFirstError(
  result: McpWireResult,
  mode: "http" | "stdio",
): "modern" | "legacy" | "fail" {
  const code = result.error?.code;
  if (code !== undefined && isModernProtocolReject(code)) return "modern";
  if (mode === "stdio") return "legacy";
  const status = result.httpStatus;
  if (status === 401 || status === 403) return "fail";
  if (status !== undefined && status >= 500) return "fail";
  if (status === 400) return "legacy";
  return "fail";
}

function rpcFailure(result: McpWireResult, method: string): Error {
  if (result.error) {
    return new McpTransportError(`ai.mcp: ${method} failed: ${result.error.message}`, {
      ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
      rpc: result.error,
    });
  }
  return new McpTransportError(`ai.mcp: ${method} failed`, {
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    network: result.httpStatus === undefined,
  });
}

function httpOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function withTimeout(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("ai.mcp: stdio discover timeout")), ms);
  const unlink = (): void => {
    clearTimeout(timer);
  };
  if (parent) {
    if (parent.aborted) {
      clearTimeout(timer);
      ctrl.abort(parent.reason);
    } else {
      parent.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          ctrl.abort(parent.reason);
        },
        { once: true },
      );
    }
  }
  ctrl.signal.addEventListener("abort", unlink, { once: true });
  return ctrl.signal;
}
