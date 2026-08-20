/**
 * stdio MCP transport — newline-delimited JSON-RPC over a child process.
 *
 * Cancel = `notifications/cancelled` then kill the process.
 */

import { abortError } from "../../kernel/abort-scope.ts";
import { parseJsonRpcResponse } from "./mcp-protocol.ts";
import {
  McpTransportError,
  type McpTransport,
  type McpTransportRequest,
  type McpWireResult,
} from "./mcp-transport.ts";

/** Byte writer used by {@link StdioChild.stdin}. */
export interface StdioWriter {
  write(data: Uint8Array): Promise<void> | void;
  close(): Promise<void> | void;
}

/** Options for {@link createMcpStdioTransport}. */
export interface CreateMcpStdioTransportOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly spawn?: (cmd: string, args: readonly string[]) => StdioChild;
}

/** Minimal child-process handle (Bun.spawn-compatible). */
export interface StdioChild {
  readonly stdin: StdioWriter | WritableStream<Uint8Array> | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly killed?: boolean;
  kill(): void;
}

interface Pending {
  readonly resolve: (value: McpWireResult) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * Create a stdio transport. The process is spawned on first request.
 *
 * @param options - Command + args (never a shell string)
 */
export function createMcpStdioTransport(options: CreateMcpStdioTransportOptions): McpTransport {
  let child: StdioChild | undefined;
  let writer: StdioWriter | undefined;
  const pending = new Map<string, Pending>();
  let readLoop: Promise<void> | undefined;
  const encoder = new TextEncoder();

  async function ensureChild(): Promise<void> {
    if (child) return;
    const spawn = options.spawn ?? defaultSpawn;
    child = spawn(options.command, options.args ?? []);
    if (!child.stdin || !child.stdout) {
      throw new Error("ai.mcp: stdio process is missing stdin/stdout");
    }
    writer = asWriter(child.stdin);
    readLoop = consumeStdout(child.stdout, pending);
  }

  return {
    kind: "stdio",
    async request(request: McpTransportRequest): Promise<McpWireResult> {
      if (request.signal?.aborted) throw abortError(request.signal.reason);
      await ensureChild();
      if (!writer) throw new Error("ai.mcp: stdio stdin is not writable");
      const key = String(request.id);
      const envelope = JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        method: request.method,
        ...(request.params !== undefined ? { params: request.params } : {}),
      });
      const result = new Promise<McpWireResult>((resolve, reject) => {
        pending.set(key, { resolve, reject });
      });
      const onAbort = (): void => {
        void writeLine(
          writer!,
          encoder,
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: request.id },
          }),
        ).finally(() => {
          child?.kill();
          child = undefined;
          writer = undefined;
          rejectAll(pending, abortError(request.signal?.reason));
        });
      };
      request.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await writeLine(writer, encoder, envelope);
        return await result;
      } finally {
        request.signal?.removeEventListener("abort", onAbort);
        pending.delete(key);
      }
    },
    async close() {
      child?.kill();
      child = undefined;
      try {
        await writer?.close();
      } catch {
        /* already closed */
      }
      writer = undefined;
      rejectAll(pending, new Error("ai.mcp: stdio transport closed"));
      await readLoop?.catch(() => undefined);
    },
  };
}

function defaultSpawn(command: string, args: readonly string[]): StdioChild {
  const proc = Bun.spawn([command, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdin: {
      write(data) {
        proc.stdin.write(data);
      },
      close() {
        proc.stdin.end();
      },
    },
    stdout: proc.stdout,
    kill() {
      proc.kill();
    },
  };
}

function asWriter(stdin: StdioWriter | WritableStream<Uint8Array>): StdioWriter {
  if (isWritableStream(stdin)) {
    const streamWriter = stdin.getWriter();
    return {
      write: (data) => streamWriter.write(data),
      close: () => streamWriter.close(),
    };
  }
  return stdin;
}

function isWritableStream(
  value: StdioWriter | WritableStream<Uint8Array>,
): value is WritableStream<Uint8Array> {
  return "getWriter" in value && typeof value.getWriter === "function";
}

async function writeLine(writer: StdioWriter, encoder: TextEncoder, line: string): Promise<void> {
  await writer.write(encoder.encode(`${line}\n`));
}

async function consumeStdout(
  stdout: ReadableStream<Uint8Array>,
  pending: Map<string, Pending>,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stdout.getReader();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let json: unknown;
        try {
          json = JSON.parse(trimmed) as unknown;
        } catch {
          continue;
        }
        const parsed = parseJsonRpcResponse(json);
        if (!parsed) continue;
        const key = parsed.id === null ? undefined : String(parsed.id);
        if (key === undefined) continue;
        const waiter = pending.get(key);
        if (!waiter) continue;
        pending.delete(key);
        if (parsed.ok) {
          waiter.resolve({ ok: true, result: parsed.result, rawBody: json });
        } else {
          waiter.resolve({ ok: false, error: parsed.error, rawBody: json });
        }
      }
    }
  } catch (err) {
    rejectAll(pending, err);
  } finally {
    reader.releaseLock();
    rejectAll(pending, new McpTransportError("ai.mcp: stdio process ended", { network: true }));
  }
}

function rejectAll(pending: Map<string, Pending>, reason: unknown): void {
  for (const waiter of pending.values()) waiter.reject(reason);
  pending.clear();
}
