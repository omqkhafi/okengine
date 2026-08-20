/**
 * MCP client — allowlist, era fallback, abort, capability.
 */

import { describe, expect, test } from "bun:test";
import { createMockAiDriver } from "../../drivers/ai-mock.ts";
import { createFx } from "../../kernel/fx.ts";
import {
  mcpCapabilityRefFromName,
  mcpModelToolName,
  parseMcpToolRef,
} from "../../manifest/mcp-ref.ts";
import { ai } from "./declare.ts";
import { createMcpClient } from "./mcp-client.ts";
import { createMockMcpTransport } from "./mcp-mock.ts";
import { createAiRuntime } from "./runtime.ts";

describe("mcp refs", () => {
  test("parses capability and model names", () => {
    expect(parseMcpToolRef("mcp:github/create_issue")).toEqual({
      server: "github",
      tool: "create_issue",
    });
    expect(mcpModelToolName("github", "create_issue")).toBe("github__create_issue");
    expect(mcpCapabilityRefFromName("github__create_issue")).toBe("mcp:github/create_issue");
    expect(parseMcpToolRef("github/create_issue")).toBeNull();
  });
});

describe("mcp client allowlist", () => {
  test("drops extras from tools/list and calls only allowlisted tools", async () => {
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    const called: string[] = [];
    const transport = createMockMcpTransport({
      tools: [
        { name: "create_issue", description: "Open an issue" },
        { name: "delete_repo", description: "should be dropped" },
      ],
      extraTools: [{ name: "admin_wipe" }],
      onCall: (name) => {
        called.push(name);
        return { content: [{ type: "text", text: "opened" }] };
      },
    });
    const client = createMcpClient({
      servers: [github],
      transports: { github: transport },
    });
    const listed = await client.listedTool({ server: "github", tool: "create_issue" });
    expect(listed?.name).toBe("create_issue");
    expect(await client.listedTool({ server: "github", tool: "delete_repo" })).toBeUndefined();
    await client.call("mcp:github/create_issue", { title: "bug" });
    expect(called).toEqual(["create_issue"]);
    await expect(client.call("mcp:github/delete_repo", {})).rejects.toThrow(/not allowlisted/);
  });
});

describe("mcp era fallback", () => {
  test("400 + UnsupportedProtocolVersion stays modern (no initialize)", async () => {
    const methods: string[] = [];
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    const transport = createMockMcpTransport({
      tools: [{ name: "create_issue" }],
      httpStatusOnFirst: 400,
      firstError: { code: -32022, message: "UnsupportedProtocolVersion" },
    });
    const wrapped = {
      kind: "mock" as const,
      async request(req: Parameters<typeof transport.request>[0]) {
        methods.push(req.method);
        return transport.request(req);
      },
      close: () => transport.close(),
    };
    const client = createMcpClient({
      servers: [github],
      transports: { github: wrapped },
    });
    await expect(client.listedTool({ server: "github", tool: "create_issue" })).rejects.toThrow(
      /UnsupportedProtocolVersion/,
    );
    expect(methods).toEqual(["tools/list"]);
  });

  test("400 without a modern body falls back to initialize", async () => {
    const methods: string[] = [];
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    const transport = createMockMcpTransport({
      era: "legacy",
      tools: [{ name: "create_issue" }],
      httpStatusOnFirst: 400,
      firstBody: "bad request",
    });
    const wrapped = {
      kind: "mock" as const,
      async request(req: Parameters<typeof transport.request>[0]) {
        methods.push(req.method);
        return transport.request(req);
      },
      close: () => transport.close(),
    };
    const client = createMcpClient({
      servers: [github],
      transports: { github: wrapped },
    });
    const listed = await client.listedTool({ server: "github", tool: "create_issue" });
    expect(listed?.name).toBe("create_issue");
    expect(methods).toEqual(["tools/list", "initialize", "tools/list"]);
  });
});

describe("mcp abort", () => {
  test("HTTP cancel aborts an in-flight mock request", async () => {
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    const transport = createMockMcpTransport({
      tools: [{ name: "create_issue" }],
      delayMs: 5_000,
    });
    const client = createMcpClient({
      servers: [github],
      transports: { github: transport },
    });
    const ctrl = new AbortController();
    const pending = client.call("mcp:github/create_issue", {}, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("mcp capability + toolLoop", () => {
  test("undeclared MCP tool throws OKE1007", async () => {
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    const runtime = createAiRuntime({
      mcpServers: [github],
      mcpTransports: { github: createMockMcpTransport({ tools: [{ name: "create_issue" }] }) },
    });
    const fx = createFx({
      flow: "support.triage",
      effects: { asks: ["triage"] },
      aiRuntime: runtime,
    });
    try {
      await fx.call(github.tool("create_issue"), { title: "x" });
      throw new Error("expected OKE1007");
    } catch (err) {
      expect(err).toMatchObject({ code: 1007 });
    }
  });

  test("model-facing server__tool dispatches through fx.call as mcp: ref", async () => {
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    const called: string[] = [];
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      prompts: [ai.model("smart").prompt("triage")],
      mcpServers: [github],
      mcpTransports: {
        github: createMockMcpTransport({
          tools: [{ name: "create_issue", description: "Open an issue" }],
          onCall: (name) => {
            called.push(name);
            return { content: [{ type: "text", text: "ok" }] };
          },
        }),
      },
      defaultDriver: createMockAiDriver({
        "*": {
          __toolCalls: [{ id: "c1", name: "github__create_issue", arguments: { title: "bug" } }],
        },
      }),
    });
    const fx = createFx({
      flow: "support.triage",
      effects: { asks: ["triage"], calls: ["mcp:github/create_issue"] },
      aiRuntime: runtime,
    });
    await runtime.ask(
      "triage",
      { q: "open" },
      {
        tools: ["mcp:github/create_issue"],
        maxSteps: 1,
        callTool: (name, input) => fx.call(name, input),
      },
    );
    expect(called).toEqual(["create_issue"]);
  });
});
