/**
 * Gate: `/llms.txt` (Fumadocs `llms(source).index()`) lists every real nav
 * page and introduces no orphan links. Nav is the meta.json tree written by
 * handbook navigation.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { llms } from "fumadocs-core/source";
import { source } from "../lib/source.ts";

const DOCS = join(import.meta.dir, "..", "content", "docs");

interface MetaJson {
  readonly title?: string;
  readonly pages?: readonly string[];
}

/**
 * Collect doc slugs (URL path under /docs) from meta.json pages arrays.
 *
 * @param dir - Absolute directory containing meta.json
 * @param prefix - Slug segments so far
 */
async function collectNavSlugs(dir: string, prefix: readonly string[] = []): Promise<string[]> {
  const metaPath = join(dir, "meta.json");
  const metaFile = Bun.file(metaPath);
  if (!(await metaFile.exists())) {
    return [];
  }
  const meta = (await metaFile.json()) as MetaJson;
  const pages = meta.pages ?? [];
  const out: string[] = [];

  for (const entry of pages) {
    if (entry === "---" || entry.startsWith("...")) continue;
    if (entry.startsWith("[")) continue;

    const childDir = join(dir, entry);
    const childMeta = Bun.file(join(childDir, "meta.json"));
    if (await childMeta.exists()) {
      out.push(...(await collectNavSlugs(childDir, [...prefix, entry])));
      continue;
    }

    const mdPath = join(dir, `${entry}.md`);
    const mdxPath = join(dir, `${entry}.mdx`);
    if ((await Bun.file(mdPath).exists()) || (await Bun.file(mdxPath).exists())) {
      const slug =
        entry === "index" && prefix.length === 0
          ? ""
          : entry === "index"
            ? prefix.join("/")
            : [...prefix, entry].join("/");
      out.push(slug);
    }
  }

  return out;
}

/**
 * Collect every `.md` / `.mdx` file under content/docs as URL slugs.
 *
 * @param dir - Absolute content root
 */
async function collectDiskSlugs(dir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string, prefix: readonly string[]): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "meta.json") continue;
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, [...prefix, entry.name]);
        continue;
      }
      const isMd = entry.name.endsWith(".md");
      const isMdx = entry.name.endsWith(".mdx");
      if (!isMd && !isMdx) continue;
      const base = entry.name.slice(0, isMdx ? -".mdx".length : -".md".length);
      if (base === "index") {
        out.push(prefix.join("/"));
      } else {
        out.push([...prefix, base].join("/"));
      }
    }
  }

  await walk(dir, []);
  return out;
}

/**
 * @param slug - Nav slug
 */
function docsUrl(slug: string): string {
  return slug.length === 0 ? "/docs" : `/docs/${slug}`;
}

/**
 * Parse markdown link targets from an llms.txt index body.
 *
 * @param body - Index markdown
 */
function parseLlmsLinks(body: string): string[] {
  const links: string[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    links.push(match[2]!);
  }
  return links;
}

/**
 * Normalize an llms link to a `/docs/...` page URL.
 *
 * @param href - Link from the index
 */
function toDocsUrl(href: string): string {
  let path = href.split("#")[0] ?? href;
  path = path.replace(/\/llms\.mdx/, "");
  path = path.replace(/\/content\.md$/, "");
  if (path.endsWith(".md")) path = path.slice(0, -3);
  if (path === "/docs/" || path === "/docs/index") return "/docs";
  return path.replace(/\/$/, "") || "/docs";
}

describe("llms.txt ↔ nav structure", () => {
  test("nav meta.json lists every on-disk docs page (and only those)", async () => {
    const nav = new Set(await collectNavSlugs(DOCS));
    const disk = new Set(await collectDiskSlugs(DOCS));

    expect(nav.size).toBeGreaterThan(10);
    expect(disk.size).toBe(nav.size);

    for (const slug of disk) {
      expect(nav.has(slug)).toBe(true);
    }
    for (const slug of nav) {
      expect(disk.has(slug)).toBe(true);
    }
  });

  test("llms(source).index() covers every nav page with no orphan links", async () => {
    const navSlugs = await collectNavSlugs(DOCS);
    const navUrls = new Set(navSlugs.map(docsUrl));
    const index = llms(source).index();
    const linkSet = new Set(parseLlmsLinks(index).map(toDocsUrl));

    // Source pages and nav must agree with the live index.
    expect(source.getPages().length).toBe(navUrls.size);
    expect(linkSet.size).toBe(navUrls.size);

    for (const url of navUrls) {
      expect(linkSet.has(url)).toBe(true);
    }
    for (const url of linkSet) {
      expect(navUrls.has(url)).toBe(true);
    }

    // Route must keep generating from the live source (not a hand file).
    const route = await Bun.file(join(import.meta.dir, "..", "app", "llms.txt", "route.ts")).text();
    expect(route).toContain("llms(source).index()");
  });
});
