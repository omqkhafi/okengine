/**
 * Docs MCP acceptance:
 * - Host/Origin validation (same class as app MCP)
 * - tools/list exposes only search + get
 * - oke.docs.get matches on-disk source (frontmatter stripped)
 * - search finds a known page
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { isDataEnvelope } from "./data.ts";
import {
  defaultDocsContentDir,
  loadDocsIndex,
  stripYamlFrontmatter,
} from "./docs-index.ts";
import { createDocsMcpServer } from "./docs-server.ts";
import { createMcpServer } from "./server.ts";
import { createSessionStore } from "../auth/sessions.ts";

const CONTENT = defaultDocsContentDir();

function mcpPost(
  fetch: (request: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(
    new Request("http://127.0.0.1:6536/mcp", {
      method: "POST",
      headers: {
        host: "127.0.0.1:6536",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("docs MCP Host/Origin", () => {
  test("rejects attacker Host with 403", async () => {
    const mcp = await createDocsMcpServer({ contentDir: CONTENT });
    const res = await mcp.fetch(
      new Request("http://127.0.0.1:6536/health", {
        headers: { host: "attacker.example" },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Host");
  });

  test("rejects disallowed Origin with 403", async () => {
    const mcp = await createDocsMcpServer({ contentDir: CONTENT });
    const res = await mcp.fetch(
      new Request("http://127.0.0.1:6536/health", {
        headers: {
          host: "127.0.0.1:6536",
          origin: "https://evil.example",
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Origin");
  });

  test("allows loopback Host on /health", async () => {
    const mcp = await createDocsMcpServer({ contentDir: CONTENT });
    const res = await mcp.fetch(
      new Request("http://127.0.0.1:6536/health", {
        headers: { host: "127.0.0.1:6536" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { surface: string };
    expect(json.surface).toBe("docs-mcp");
  });
});

describe("app MCP Host/Origin (behavioral)", () => {
  test("rejects attacker Host with 403 before auth", async () => {
    const store = createSessionStore();
    const mcp = createMcpServer({
      sessions: store,
      secret: "test-secret",
      context: {
        getManifest: () => null,
        listRuns: async () => [],
      },
      hostname: "127.0.0.1",
    });
    const res = await mcp.fetch(
      new Request("http://127.0.0.1:6535/health", {
        headers: { host: "attacker.example" },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("docs MCP tools", () => {
  test("tools/list exposes only oke.docs.search and oke.docs.get", async () => {
    const mcp = await createDocsMcpServer({ contentDir: CONTENT });
    const res = await mcpPost(mcp.fetch, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = json.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["oke.docs.get", "oke.docs.search"]);
  });

  test("oke.docs.get returns body byte-identical to on-disk source", async () => {
    const mcp = await createDocsMcpServer({ contentDir: CONTENT });
    const slug = "get-started/introduction";
    const res = await mcpPost(mcp.fetch, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "oke.docs.get",
        arguments: { slug },
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result: { structuredContent: unknown };
    };
    const envelope = json.result.structuredContent;
    expect(isDataEnvelope(envelope)).toBe(true);
    if (!isDataEnvelope(envelope)) return;
    expect(envelope.provenance).toBe("docs");
    const content = envelope.content as { body: string; slug: string };
    expect(content.slug).toBe(slug);

    const raw = await Bun.file(
      join(CONTENT, "get-started", "introduction.mdx"),
    ).text();
    expect(content.body).toBe(stripYamlFrontmatter(raw));
  });

  test("oke.docs.search finds a known page", async () => {
    const index = await loadDocsIndex(CONTENT);
    const mcp = await createDocsMcpServer({ index });
    const res = await mcpPost(mcp.fetch, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "oke.docs.search",
        arguments: { query: "eight elements" },
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result: { structuredContent: unknown };
    };
    const envelope = json.result.structuredContent;
    expect(isDataEnvelope(envelope)).toBe(true);
    if (!isDataEnvelope(envelope)) return;
    const content = envelope.content as {
      hits: Array<{ slug: string; title: string }>;
    };
    expect(content.hits.length).toBeGreaterThan(0);
    expect(
      content.hits.some(
        (h) =>
          h.slug.includes("introduction") || h.slug.includes("elements"),
      ),
    ).toBe(true);
  });
});
