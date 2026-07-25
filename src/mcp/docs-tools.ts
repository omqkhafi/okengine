/**
 * Read-only docs MCP tools — search and fetch documentation pages.
 *
 * Every return goes through {@link asData}. No write tools, no auth scopes.
 */

import { asData, type McpDataEnvelope } from "./data.ts";
import type { DocsIndex } from "./docs-index.ts";

/** Result of a docs tool call. */
export type DocsToolCallResult =
  | { readonly ok: true; readonly data: McpDataEnvelope }
  | {
      readonly ok: false;
      readonly code: "invalid" | "not-found";
      readonly message: string;
      readonly data: McpDataEnvelope;
    };

/** Tool descriptor exposed via `tools/list`. */
export interface DocsToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** Docs MCP tool catalogue. */
export const DOCS_MCP_TOOLS: readonly DocsToolDescriptor[] = [
  {
    name: "oke.docs.search",
    description:
      "Search okengine documentation pages by keyword. Returns slug, title, url, and excerpt.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "oke.docs.get",
    description:
      "Fetch a documentation page by slug or content path. Returns source-identical markdown (YAML frontmatter stripped).",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "Page slug (e.g. get-started/introduction) or path (…/introduction.mdx)",
        },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Create the docs tool runtime bound to an index.
 *
 * @param index - Loaded docs catalogue
 */
export function createDocsToolRuntime(index: DocsIndex): {
  readonly listTools: () => readonly DocsToolDescriptor[];
  readonly callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => DocsToolCallResult;
} {
  return {
    listTools: () => DOCS_MCP_TOOLS,
    callTool(name, args) {
      if (name === "oke.docs.search") {
        const query = args.query;
        if (typeof query !== "string" || query.trim().length === 0) {
          return {
            ok: false,
            code: "invalid",
            message: "query must be a non-empty string",
            data: asData({ reason: "invalid-query" }, "error"),
          };
        }
        const limit =
          typeof args.limit === "number" && Number.isFinite(args.limit)
            ? Math.max(1, Math.min(100, Math.floor(args.limit)))
            : 20;
        const hits = index.search(query, limit);
        return {
          ok: true,
          data: asData({ query, hits }, "docs"),
        };
      }

      if (name === "oke.docs.get") {
        const slug = args.slug;
        if (typeof slug !== "string" || slug.trim().length === 0) {
          return {
            ok: false,
            code: "invalid",
            message: "slug must be a non-empty string",
            data: asData({ reason: "invalid-slug" }, "error"),
          };
        }
        const page = index.get(slug.trim());
        if (!page) {
          return {
            ok: false,
            code: "not-found",
            message: `docs page not found: ${slug}`,
            data: asData({ slug }, "error"),
          };
        }
        return {
          ok: true,
          data: asData(
            {
              slug: page.slug,
              path: page.path,
              title: page.title,
              url: page.url,
              body: page.body,
            },
            "docs",
          ),
        };
      }

      return {
        ok: false,
        code: "not-found",
        message: `unknown tool: ${name}`,
        data: asData({ tool: name }, "error"),
      };
    },
  };
}
