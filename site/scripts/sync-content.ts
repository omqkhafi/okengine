#!/usr/bin/env bun
/**
 * Transclude canonical `docs/spec/*.md` (and README / create-oke / AGENTS.md)
 * into Fumadocs pages. The site organizes and renders; it does not invent facts.
 *
 * Usage: bun scripts/sync-content.ts
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SITE = resolve(import.meta.dir, "..");
const ROOT = resolve(SITE, "..");
const OUT = join(SITE, "content/docs");

/** One generated docs page. */
interface Page {
  readonly path: string;
  readonly title: string;
  readonly description?: string;
  readonly source: string;
  readonly body: string;
  /** Lucide icon name for the page tree (optional). */
  readonly icon?: string;
}

/**
 * Read a repo-relative UTF-8 file.
 *
 * @param rel - Path from monorepo root
 */
async function readRoot(rel: string): Promise<string> {
  return Bun.file(join(ROOT, rel)).text();
}

/**
 * Extract a half-open heading range from markdown.
 *
 * @param md - Full document
 * @param start - Inclusive start heading
 * @param end - Exclusive end heading, or null for EOF
 */
function extractBetween(
  md: string,
  start: string | RegExp,
  end: string | RegExp | null,
): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const hit =
      typeof start === "string"
        ? line === start || line.startsWith(start)
        : start.test(line);
    if (hit) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) {
    throw new Error(`sync-content: start heading not found: ${String(start)}`);
  }
  let endIdx = lines.length;
  if (end) {
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i]!;
      const hit =
        typeof end === "string"
          ? line === end || line.startsWith(end)
          : end.test(line);
      if (hit) {
        endIdx = i;
        break;
      }
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim() + "\n";
}

/**
 * Demote ATX headings by one level so pages keep a single document title.
 * Claimed-fence headings (`### \`path\``) stay at ### so doc-drift can see them.
 *
 * @param md - Extracted section
 */
function demoteHeadings(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      if (/^### `/.test(line)) return line;
      if (/^#{1,5} /.test(line)) return `#${line}`;
      return line;
    })
    .join("\n");
}

/**
 * Rewrite relative claimed-fence headings to `examples/<app>/…`.
 *
 * @param md - Learn-page body
 * @param app - Example package name
 */
function absolutizeClaimedPaths(md: string, app: string): string {
  return md.replace(
    /^### `((?!examples\/)[^`]+)`/gm,
    (_m, rel: string) => `### \`examples/${app}/${rel}\``,
  );
}

/**
 * Read the typescript fence after a `### \`relPath\`` heading (suffix allowed).
 *
 * @param md - Spec markdown
 * @param relPath - Path inside the heading backticks
 */
function readFenceAfterPath(md: string, relPath: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const prefix = `### \`${relPath}\``;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith(prefix)) continue;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (!lines[j] || !/^```(?:typescript|ts)\s*$/.test(lines[j]!)) {
      throw new Error(`sync-content: no ts fence after ${relPath}`);
    }
    j++;
    const body: string[] = [];
    while (j < lines.length && !lines[j]!.startsWith("```")) {
      body.push(lines[j]!);
      j++;
    }
    if (j >= lines.length) {
      throw new Error(`sync-content: unclosed fence after ${relPath}`);
    }
    return body.join("\n");
  }
  throw new Error(`sync-content: heading not found: ${relPath}`);
}

/**
 * Claimed fence block with absolute examples/ path for doc-drift.
 *
 * @param app - Example app
 * @param rel - Relative path under the app
 * @param body - Fence body
 */
function claimedBlock(app: string, rel: string, body: string): string {
  return [
    `### \`examples/${app}/${rel}\``,
    "",
    "```typescript",
    body,
    "```",
    "",
  ].join("\n");
}

/**
 * Serialize a page with YAML frontmatter.
 *
 * @param page - Page descriptor
 */
function serialize(page: Page): string {
  const desc = page.description
    ? `description: ${JSON.stringify(page.description)}\n`
    : "";
  const icon = page.icon ? `icon: ${JSON.stringify(page.icon)}\n` : "";
  return `---
title: ${JSON.stringify(page.title)}
${desc}${icon}source: ${JSON.stringify(page.source)}
---

${page.body.trim()}\n`;
}

/**
 * Write meta.json for a folder.
 *
 * @param dir - Absolute directory
 * @param meta - Meta payload
 */
async function writeMeta(
  dir: string,
  meta: Record<string, unknown>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Write a content page.
 *
 * @param page - Page descriptor
 */
async function writePage(page: Page): Promise<void> {
  const abs = join(OUT, page.path);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, serialize(page));
}

/**
 * Element table row from unified-theory §5.
 *
 * @param theory - Spec text
 * @param title - Element name
 */
function elementTableRow(theory: string, title: string): string {
  const re = new RegExp(
    `^\\| \\*\\*${title}\\*\\* \\|([^|]+)\\|([^|]+)\\|`,
    "m",
  );
  const m = re.exec(theory);
  if (!m) throw new Error(`sync-content: element row missing: ${title}`);
  return [
    "| Element | Replaces the zoo of | Essence |",
    "|---|---|---|",
    `| **${title}** |${m[1]}|${m[2]}|`,
    "",
  ].join("\n");
}

/**
 * Catalog row for a conditional Console panel.
 *
 * @param consoleSpec - Console spec text
 * @param title - Panel title
 */
function conditionalCatalogRow(consoleSpec: string, title: string): string {
  const re = new RegExp(
    `^\\| (\\d+) \\| \\*\\*${title}\\*\\*([^|]*)\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|`,
    "m",
  );
  const row = re.exec(consoleSpec);
  if (!row) {
    throw new Error(`sync-content: catalog row missing: ${title}`);
  }
  return [
    "| # | Panel | Answers | Dev | Prod |",
    "|---|---|---|---|---|",
    `| ${row[1]} | **${title}**${row[2]}|${row[3]}|${row[4]}|${row[5]}|`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const theory = await readRoot("docs/spec/unified-theory.md");
  const four = await readRoot("docs/spec/four-applications.md");
  const consoleSpec = await readRoot("docs/spec/console.md");
  const readme = await readRoot("README.md");
  const agents = await readRoot("AGENTS.md");

  // Preserve hand-authored Get Started MDX (better-auth how-to style).
  await mkdir(OUT, { recursive: true });
  for (const name of [
    "learn",
    "elements",
    "console",
    "ai",
    "index.md",
    "plugins.md",
    "cli.md",
    "security.md",
  ]) {
    await rm(join(OUT, name), { recursive: true, force: true });
  }

  const pages: Page[] = [];

  // Get Started is hand-authored under content/docs/get-started/*.mdx — not synced.

  // ── Learn ────────────────────────────────────────────────────────────────
  const learnApps = [
    {
      slug: "notes",
      title: "Notes",
      description: "Basic — the one law, contracts, typed errors, the client.",
      start: /^# 1 · BASIC — Notes\b/,
      end: /^# 2 · INTERMEDIATE — Linkly\b/,
      app: "notes",
    },
    {
      slug: "linkly",
      title: "Linkly",
      description: "Intermediate — Signal, Clock, Gate, delivery physics.",
      start: /^# 2 · INTERMEDIATE — Linkly\b/,
      end: /^# 3 · ADVANCED — Provisions\b/,
      app: "linkly",
    },
    {
      slug: "provisions",
      title: "Provisions",
      description: "Advanced — durability, Vault, Channel, plugins.",
      start: /^# 3 · ADVANCED — Provisions\b/,
      end: /^# 4 · COMPLEX — Skyport\b/,
      app: "provisions",
    },
    {
      slug: "skyport",
      title: "Skyport",
      description: "Complex — AI, tenancy, SLOs, distributed topology.",
      start: /^# 4 · COMPLEX — Skyport\b/,
      end: /^# REFERENCE\b/,
      app: "skyport",
    },
  ] as const;

  for (const app of learnApps) {
    const raw = extractBetween(four, app.start, app.end);
    const body = demoteHeadings(absolutizeClaimedPaths(raw, app.app));
    pages.push({
      path: `learn/${app.slug}.md`,
      title: app.title,
      description: app.description,
      source: "docs/spec/four-applications.md",
      body: [
        `> **${app.description}**`,
        ">",
        `> Scaffold: \`bunx create-oke@latest my-${app.app} --from-example ${app.app}\` then \`oke dev\` (app \`:6530\`, Console \`:6533\`).`,
        "",
        body,
      ].join("\n"),
    });
  }

  // ── Elements ─────────────────────────────────────────────────────────────
  const elementSpecs: ReadonlyArray<{
    slug: string;
    title: string;
    essence: string;
    blurb: string;
    next?: { href: string; label: string };
    extra?: { start: string | RegExp; end: string | RegExp | null };
    fenceApp: string;
    fenceRel: string;
  }> = [
    {
      slug: "flow",
      title: "Flow",
      essence: "behavior",
      blurb:
        "Endpoints, jobs, consumers, and workflows are one species. You bind a typed trigger with `on`, declare contracts, and implement `do` through `fx`.",
      next: { href: "/docs/elements/signal", label: "Signal" },
      fenceApp: "notes",
      fenceRel: "src/flows/notes/index.ts",
    },
    {
      slug: "signal",
      title: "Signal",
      essence: "data in motion",
      blurb:
        "Queues, pub/sub, and streams collapse into one Signal. Delivery physics (`once` · `broadcast` · `live`) is mandatory — no silent default.",
      next: { href: "/docs/elements/store", label: "Store" },
      extra: {
        start: "### Why queue, pub/sub, and stream collapse into one Signal",
        end: "### Why Channel is an element and not a library",
      },
      fenceApp: "linkly",
      fenceRel: "src/flows/links/signals.ts",
    },
    {
      slug: "store",
      title: "Store",
      essence: "data at rest (sql · kv · files · index)",
      blurb:
        "SQL, KV, files, and search index are facets of one Store surface. Drivers are named after protocols, not vendors.",
      next: { href: "/docs/elements/clock", label: "Clock" },
      fenceApp: "notes",
      fenceRel: "src/core.ts",
    },
    {
      slug: "clock",
      title: "Clock",
      essence: "time",
      blurb:
        "Cron, delay, timeout, durable sleep, and TTL — time as an element, not a bolted-on scheduler library.",
      next: { href: "/docs/elements/gate", label: "Gate" },
      fenceApp: "linkly",
      fenceRel: "src/flows/links/index.ts",
    },
    {
      slug: "gate",
      title: "Gate",
      essence: "permission to act",
      blurb:
        "Auth, session, ABAC, rate limits, quotas, and feature flags sit at the trigger — permission to act before effects run.",
      next: { href: "/docs/elements/vault", label: "Vault" },
      fenceApp: "linkly",
      fenceRel: "src/gates.ts",
    },
    {
      slug: "vault",
      title: "Vault",
      essence: "protected knowledge",
      blurb:
        "Secrets, config, and environment with typed contracts — protected knowledge, not a loose bag of env vars.",
      next: { href: "/docs/elements/channel", label: "Channel" },
      fenceApp: "provisions",
      fenceRel: "src/vault.ts",
    },
    {
      slug: "channel",
      title: "Channel",
      essence: "reaching humans",
      blurb:
        "Email, SMS, WhatsApp, and push have physics Signal cannot express: consent, locale, receipts, and fallback chains.",
      next: { href: "/docs/elements/ai", label: "AI" },
      extra: {
        start: "### Why Channel is an element and not a library",
        end: "### Why AI is an element and not a library",
      },
      fenceApp: "provisions",
      fenceRel: "src/channels.ts",
    },
    {
      slug: "ai",
      title: "AI",
      essence: "reaching machine intelligence",
      blurb:
        "Models, prompts, agents, and RAG earn an element slot: non-determinism, cost, versioned prompts, egress privacy, and different test physics.",
      next: { href: "/docs/learn/notes", label: "Learn · Notes" },
      extra: {
        start: "### Why AI is an element and not a library",
        end: "## 6. Ten exports",
      },
      fenceApp: "skyport",
      fenceRel: "src/ai.ts",
    },
  ];

  for (const el of elementSpecs) {
    const parts = [
      `${el.title} is the element for **${el.essence}**.`,
      "",
      el.blurb,
      "",
      "An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.",
      "",
      "## At a glance",
      "",
      elementTableRow(theory, el.title),
      el.extra
        ? [
            "## Why this is an element",
            "",
            demoteHeadings(
              extractBetween(theory, el.extra.start, el.extra.end),
            ),
          ].join("\n")
        : "",
      "## Example from the teaching apps",
      "",
      `Claimed fence from **${el.fenceApp}** — same source the doc-drift gate checks:`,
      "",
      claimedBlock(
        el.fenceApp,
        el.fenceRel,
        readFenceAfterPath(four, el.fenceRel),
      ),
      el.next
        ? [
            "## Next",
            "",
            `- [${el.next.label}](${el.next.href})`,
            `- [Introduction](/docs/get-started/introduction) — eight elements overview`,
            `- [Console](/docs/console/overview) — panels derived from the Manifest`,
            "",
          ].join("\n")
        : "",
    ];
    pages.push({
      path: `elements/${el.slug}.md`,
      title: el.title,
      description: `${el.essence} — ${el.blurb}`,
      source: "docs/spec/unified-theory.md",
      body: parts.join("\n").replace(/\n{3,}/g, "\n\n"),
    });
  }

  // ── Console panels (17) ──────────────────────────────────────────────────
  const panelCatalog = demoteHeadings(
    extractBetween(consoleSpec, "## 9. Panel catalog", "### 9.1 "),
  );

  const consolePanels: ReadonlyArray<{
    slug: string;
    title: string;
    description: string;
    sections: ReadonlyArray<{
      start: string | RegExp;
      end: string | RegExp | null;
    }>;
  }> = [
    {
      slug: "overview",
      title: "Overview",
      description: "Is the system healthy right now?",
      sections: [
        { start: "### 9.16 Overview", end: "## 10. Security posture" },
      ],
    },
    {
      slug: "flows",
      title: "Flows",
      description: "What exists; call it; read its contract.",
      sections: [{ start: "### 9.1 Flows panel", end: "### 9.3 Traces" }],
    },
    {
      slug: "signals",
      title: "Signals",
      description: "Queue depth, in-flight, DLQ, live monitors.",
      sections: [{ start: "### 9.4 Signals", end: "### 9.5 Store" }],
    },
    {
      slug: "store",
      title: "Store",
      description: "Browse sql/kv/files/index; cache keys; replica lag.",
      sections: [{ start: "### 9.5 Store", end: "### 9.6 Clock" }],
    },
    {
      slug: "clock",
      title: "Clock",
      description: "Upcoming crons, sleeping durable flows, journal.",
      sections: [{ start: "### 9.6 Clock", end: "### 9.7 Gates" }],
    },
    {
      slug: "gates",
      title: "Gates",
      description: "Permission matrix, rate counters, MFA map.",
      sections: [{ start: "### 9.7 Gates", end: "### 9.8 Vault" }],
    },
    {
      slug: "vault",
      title: "Vault",
      description: "Secret contracts, who can read each, rotation due.",
      sections: [{ start: "### 9.8 Vault", end: "### 9.9 Channels" }],
    },
    {
      slug: "channels",
      title: "Channels",
      description: "Templates, delivery receipts, bounces, opt-outs.",
      sections: [{ start: "### 9.9 Channels", end: "### 9.10 AI" }],
    },
    {
      slug: "ai",
      title: "AI",
      description: "Prompt versions, eval scores, cost, agent runs.",
      sections: [{ start: "### 9.10 AI", end: "### 9.11 Runs" }],
    },
    {
      slug: "architecture",
      title: "Architecture",
      description: "How it all connects — the diagram that is the code.",
      sections: [{ start: "### 9.13 Architecture", end: "### 9.14 Access" }],
    },
    {
      slug: "traces",
      title: "Traces",
      description: "One timeline across http → store → signal → durable steps.",
      sections: [{ start: "### 9.3 Traces", end: "### 9.4 Signals" }],
    },
    {
      slug: "runs",
      title: "Runs",
      description: "Wide events — one record per flow execution.",
      sections: [
        { start: "### 9.11 Runs", end: "### 9.12 Manifest Diff" },
      ],
    },
    {
      slug: "manifest-diff",
      title: "Manifest Diff",
      description: "Blast radius of a deploy: new effects, widened permissions.",
      sections: [
        { start: "### 9.12 Manifest Diff", end: "### 9.13 Architecture" },
      ],
    },
    {
      slug: "access",
      title: "Access",
      description: "Identities, roles, API keys.",
      sections: [{ start: "### 9.14 Access", end: "### 9.15 Plugins" }],
    },
    {
      slug: "plugins",
      title: "Plugins",
      description: "Installed plugins and their contributed panels.",
      sections: [{ start: "### 9.15 Plugins", end: "### 9.16 Overview" }],
    },
    {
      slug: "privacy",
      title: "Privacy",
      description: "Where PII lives, who touches it, export/erase (conditional).",
      sections: [],
    },
    {
      slug: "tenancy",
      title: "Tenancy",
      description: "Per-tenant usage, limits, isolation checks (conditional).",
      sections: [],
    },
  ];

  for (const panel of consolePanels) {
    let body: string;
    if (panel.sections.length === 0) {
      body = [
        panelCatalog,
        "",
        `## ${panel.title}`,
        "",
        conditionalCatalogRow(consoleSpec, panel.title),
        "",
        "This panel is **conditional** — it appears when the optional core plugin is plugged. The panel catalog above is the durable reference; there is no separate detailed subsection in the Console specification beyond that row.",
        "",
      ].join("\n");
    } else {
      body = panel.sections
        .map((s) => demoteHeadings(extractBetween(consoleSpec, s.start, s.end)))
        .join("\n\n");
    }
    pages.push({
      path: `console/${panel.slug}.md`,
      title: panel.title,
      description: panel.description,
      source: "docs/spec/console.md",
      body,
    });
  }

  // ── Plugins / CLI / Security ─────────────────────────────────────────────
  pages.push({
    path: "plugins.md",
    title: "Plugins",
    description: "The extensibility law — public plugin API only.",
    icon: "Puzzle",
    source: "docs/spec/unified-theory.md",
    body: demoteHeadings(
      extractBetween(
        theory,
        "## 14. Plugins — the extensibility law",
        "## 15. The Console",
      ),
    ),
  });

  const cliFromFour = demoteHeadings(
    extractBetween(four, "## Commands", "## The Console at"),
  );
  const cliReadmeFull = (() => {
    const marker = "\n## CLI\n";
    const start = readme.indexOf(marker);
    if (start < 0) return "";
    const rest = readme.slice(start + 1);
    const next = rest.search(/\n## [A-Z]/);
    const section = next < 0 ? rest : rest.slice(0, next);
    return demoteHeadings(`${section.trim()}\n`);
  })();

  pages.push({
    path: "cli.md",
    title: "CLI Reference",
    description: "oke and create-oke — everyday commands and flags.",
    icon: "Terminal",
    source: "README.md",
    body: [cliFromFour, "", cliReadmeFull].join("\n"),
  });

  pages.push({
    path: "security.md",
    title: "Security",
    description: "Console security posture — DNS rebinding, XSS, MCP.",
    icon: "Shield",
    source: "docs/spec/console.md",
    body: demoteHeadings(
      extractBetween(
        consoleSpec,
        "## 10. Security posture",
        "## 11. Cross-cutting behaviour",
      ),
    ),
  });

  // ── AI Resources ─────────────────────────────────────────────────────────
  const aiContract = demoteHeadings(
    extractBetween(theory, "## 25. The AI contract", "## 26. Roadmap"),
  );
  const agentsExcerpt = demoteHeadings(
    extractBetween(agents, "# OKE — Agent Contract", "## The one law"),
  );
  pages.push({
    path: "ai/resources.md",
    title: "AI Resources",
    description: "AGENTS.md, MCP :6535, and machine-readable docs surfaces.",
    source: "docs/spec/unified-theory.md",
    body: [
      aiContract,
      "",
      "## Agent contract (AGENTS.md)",
      "",
      agentsExcerpt,
      "",
      "## Machine-readable docs",
      "",
      "This documentation site also exposes Fumadocs AI surfaces (same pattern as modern TS library docs):",
      "",
      "- [`/llms.txt`](/llms.txt) — index of documentation pages for agents",
      "- [`/llms-full.txt`](/llms-full.txt) — full concatenated docs text",
      "- `/llms.mdx/docs/...` — per-page markdown for a given docs slug",
      "",
      "The runtime MCP surface remains on port **6535** (see the AI contract above).",
      "",
    ].join("\n"),
  });

  pages.push({
    path: "index.md",
    title: "Documentation",
    description: "One law. Eight elements. Ten exports.",
    source: "docs/spec/unified-theory.md",
    body: [
      "Welcome to the okengine handbook. Start with **Get Started** if you are new; use **Learn** for progressive teaching apps; open **Elements** or **Console** when you need a reference page.",
      "",
      "## The one law",
      "",
      demoteHeadings(
        extractBetween(
          theory,
          "## 4. The One Law",
          "## 5. The Eight Elements",
        ),
      )
        // Drop the demoted "## 4. …" heading — page title already covers it.
        .replace(/^### 4\. The One Law\n+/m, ""),
      "",
      "## Recommended path",
      "",
      "1. [Introduction](/docs/get-started/introduction) — one law, eight elements, ten exports",
      "2. [Installation](/docs/get-started/installation) — `bun add` + `create-oke`",
      "3. [Basic Usage](/docs/get-started/basic-usage) — first flows, client, and tests",
      "4. [Notes](/docs/learn/notes) — full Basic teaching walkthrough",
      "",
      "## Browse by topic",
      "",
      "- [Comparison](/docs/get-started/comparison) — vs Hono, Elysia, Encore.ts, iii",
      "- [Elements](/docs/elements/flow) — Flow → AI, one page each",
      "- [Console](/docs/console/overview) — seventeen panels from the Manifest",
      "- [CLI Reference](/docs/cli) — `oke` and `create-oke`",
      "- [AI Resources](/docs/ai/resources) — AGENTS.md, MCP `:6535`, `/llms.txt`",
      "",
    ].join("\n"),
  });

  for (const page of pages) {
    await writePage(page);
  }

  await writeMeta(OUT, {
    title: "Documentation",
    icon: "BookOpen",
    pages: [
      "index",
      "---",
      "get-started",
      "learn",
      "elements",
      "console",
      "---",
      "plugins",
      "cli",
      "security",
      "ai",
    ],
  });

  // get-started/meta.json is hand-authored — do not overwrite.

  await writeMeta(join(OUT, "learn"), {
    title: "Learn",
    icon: "GraduationCap",
    pages: ["notes", "linkly", "provisions", "skyport"],
  });

  await writeMeta(join(OUT, "elements"), {
    title: "Elements",
    icon: "Boxes",
    pages: [
      "flow",
      "signal",
      "store",
      "clock",
      "gate",
      "vault",
      "channel",
      "ai",
    ],
  });

  await writeMeta(join(OUT, "console"), {
    title: "Console",
    icon: "LayoutDashboard",
    pages: [
      "overview",
      "flows",
      "signals",
      "store",
      "clock",
      "gates",
      "vault",
      "channels",
      "ai",
      "architecture",
      "traces",
      "runs",
      "manifest-diff",
      "access",
      "plugins",
      "privacy",
      "tenancy",
    ],
  });

  await writeMeta(join(OUT, "ai"), {
    title: "AI Resources",
    icon: "Bot",
    pages: ["resources"],
  });

  console.log(
    `sync-content: wrote ${pages.length} synced pages → content/docs (get-started preserved)`,
  );
}

if (import.meta.main) {
  await main();
}
