/**
 * stdio MCP transport — cancel writes notifications/cancelled then kills.
 */

import { describe, expect, test } from "bun:test";
import { createMcpStdioTransport, type StdioChild } from "./mcp-stdio.ts";

describe("mcp stdio cancel", () => {
  test("abort sends notifications/cancelled then kills the process", async () => {
    const writes: string[] = [];
    let killed = false;
    const stdin = new TransformStream<Uint8Array, Uint8Array>();
    const stdout = new TransformStream<Uint8Array, Uint8Array>();
    const reader = stdin.readable.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writes.push(decoder.decode(value));
      }
    })();

    const child: StdioChild = {
      stdin: stdin.writable,
      stdout: stdout.readable,
      kill() {
        killed = true;
      },
    };
    const transport = createMcpStdioTransport({
      command: "mcp-server",
      spawn: () => child,
    });
    const ctrl = new AbortController();
    const pending = transport.request({
      id: 1,
      method: "tools/call",
      params: { name: "create_issue" },
      headers: {},
      signal: ctrl.signal,
      cancelMode: "stdio",
    });
    await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(killed).toBe(true);
    expect(writes.some((w) => w.includes("notifications/cancelled"))).toBe(true);
  });
});
