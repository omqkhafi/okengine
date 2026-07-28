/**
 * Read-only docs index for the docs MCP surface.
 *
 * Loads generated pages under `site/content/docs` (same tree as the docs site).
 * Bodies are YAML-frontmatter-stripped so `oke.docs.get` matches Copy Markdown.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** One indexed documentation page. */
export interface DocsPage {
  /** URL slug under `/docs` (`""` for the index page). */
  readonly slug: string;
  /** Content-relative path (e.g. `get-started/introduction.mdx`). */
  readonly path: string;
  /** Frontmatter title. */
  readonly title: string;
  /** Frontmatter description when present. */
  readonly description: string;
  /** Docs site URL (`/docs/...`). */
  readonly url: string;
  /** Markdown body with YAML frontmatter removed. */
  readonly body: string;
}

/** Search hit returned by {@link DocsIndex.search}. */
export interface DocsSearchHit {
  readonly slug: string;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string;
}

/** In-memory docs catalogue. */
export interface DocsIndex {
  /** All loaded pages. */
  readonly pages: readonly DocsPage[];
  /**
   * Look up a page by slug or content path.
   *
   * @param id - Slug (`get-started/introduction`) or path (`…/introduction.mdx`)
   */
  readonly get: (id: string) => DocsPage | null;
  /**
   * Case-insensitive search over title, description, and body.
   *
   * @param query - Search string
   * @param limit - Max hits (default 20)
   */
  readonly search: (query: string, limit?: number) => readonly DocsSearchHit[];
}

/**
 * Strip a leading YAML frontmatter block (`---` … `---`).
 *
 * @param raw - Full file contents
 */
export function stripYamlFrontmatter(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return normalized;
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return normalized;
  }
  return normalized.slice(end + "\n---\n".length).replace(/^\n/, "");
}

/**
 * Parse `title` / `description` from a YAML frontmatter block.
 *
 * @param raw - Full file contents
 */
export function parseDocsFrontmatter(raw: string): {
  readonly title: string;
  readonly description: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { title: "", description: "" };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { title: "", description: "" };
  }
  const block = normalized.slice(4, end);
  let title = "";
  let description = "";
  for (const line of block.split("\n")) {
    const titleMatch = /^title:\s*(.*)$/.exec(line);
    if (titleMatch) {
      title = unquoteYaml(titleMatch[1] ?? "");
      continue;
    }
    const descMatch = /^description:\s*(.*)$/.exec(line);
    if (descMatch) {
      description = unquoteYaml(descMatch[1] ?? "");
    }
  }
  return { title, description };
}

/**
 * @param value - YAML scalar (optionally quoted)
 */
function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(
        trimmed.startsWith("'") ? `"${trimmed.slice(1, -1).replace(/"/g, '\\"')}"` : trimmed,
      ) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Default absolute path to `site/content/docs` from the monorepo root.
 */
export function defaultDocsContentDir(): string {
  return join(import.meta.dir, "..", "..", "site", "content", "docs");
}

/**
 * Load every `.md` / `.mdx` file under a docs content directory into an index.
 *
 * @param contentDir - Absolute `content/docs` directory
 */
export async function loadDocsIndex(
  contentDir: string = defaultDocsContentDir(),
): Promise<DocsIndex> {
  const files = await listDocsSourceFiles(contentDir);
  const pages: DocsPage[] = [];

  for (const abs of files) {
    const relative = abs.slice(contentDir.length + 1).replaceAll("\\", "/");
    const raw = await Bun.file(abs).text();
    const { title, description } = parseDocsFrontmatter(raw);
    const body = stripYamlFrontmatter(raw);
    const slug = pathToSlug(relative);
    pages.push({
      slug,
      path: relative,
      title: title || slug || "Documentation",
      description,
      url: slug.length === 0 ? "/docs" : `/docs/${slug}`,
      body,
    });
  }

  pages.sort((a, b) => a.slug.localeCompare(b.slug));

  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const byPath = new Map(pages.map((p) => [p.path, p]));

  return {
    pages,
    get(id) {
      const normalized = id
        .replace(/^\/docs\/?/, "")
        .replace(/^\//, "")
        .replace(/\/$/, "");
      if (bySlug.has(normalized)) return bySlug.get(normalized) ?? null;
      if (byPath.has(normalized)) return byPath.get(normalized) ?? null;
      if (byPath.has(`${normalized}.mdx`)) {
        return byPath.get(`${normalized}.mdx`) ?? null;
      }
      if (byPath.has(`${normalized}.md`)) {
        return byPath.get(`${normalized}.md`) ?? null;
      }
      if (normalized === "docs" || normalized === "") {
        return bySlug.get("") ?? null;
      }
      return null;
    },
    search(query, limit = 20) {
      const q = query.trim().toLowerCase();
      if (q.length === 0) return [];
      const hits: DocsSearchHit[] = [];
      for (const page of pages) {
        const hay = `${page.title}\n${page.description}\n${page.body}`.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) continue;
        hits.push({
          slug: page.slug,
          title: page.title,
          url: page.url,
          excerpt: excerptAround(page.body, q, idx),
        });
        if (hits.length >= limit) break;
      }
      return hits;
    },
  };
}

/**
 * @param relativePath - e.g. `get-started/introduction.mdx`
 */
function pathToSlug(relativePath: string): string {
  const noExt = relativePath.replace(/\.mdx?$/i, "");
  if (noExt === "index") return "";
  if (noExt.endsWith("/index")) {
    return noExt.slice(0, -"/index".length);
  }
  return noExt;
}

/**
 * @param dir - Absolute directory
 */
async function listDocsSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listDocsSourceFiles(abs)));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * @param body - Page body
 * @param query - Lowercase query
 * @param idx - Match index in lowercased haystack (approx)
 */
function excerptAround(body: string, query: string, _idx: number): string {
  const lower = body.toLowerCase();
  const at = lower.indexOf(query);
  if (at < 0) {
    return body.slice(0, 160).trim();
  }
  const start = Math.max(0, at - 60);
  const end = Math.min(body.length, at + query.length + 100);
  const slice = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < body.length ? "…" : ""}`;
}
