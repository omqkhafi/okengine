#!/usr/bin/env bun
/**
 * Transclude canonical `docs/spec/*.md` (and `docs/cli.md` / AGENTS.md)
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

/** Card descriptor for MDX Cards grids. */
interface CardSpec {
  readonly title: string;
  readonly description: string;
  readonly href?: string;
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
function extractBetween(md: string, start: string | RegExp, end: string | RegExp | null): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const hit =
      typeof start === "string" ? line === start || line.startsWith(start) : start.test(line);
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
      const hit = typeof end === "string" ? line === end || line.startsWith(end) : end.test(line);
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
 * @param md - Section body
 * @param app - Teaching app slug
 */
function absolutizeClaimedPaths(md: string, app: string): string {
  return md.replace(
    /^### `(?!examples\/)([^`]+)`$/gm,
    (_m, rel: string) => `### \`examples/${app}/${rel}\``,
  );
}

/**
 * Read the fenced TypeScript body immediately after a path heading in four-apps.
 *
 * @param four - four-applications.md text
 * @param rel - Relative path under the app (e.g. `src/core.ts`)
 */
function readFenceAfterPath(four: string, rel: string): string {
  const heading = new RegExp(`^### \`${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``, "m");
  const hm = heading.exec(four);
  if (!hm || hm.index === undefined) {
    throw new Error(`sync-content: claimed path missing: ${rel}`);
  }
  const after = four.slice(hm.index + hm[0].length);
  const fence = /```(?:typescript|ts)?\n([\s\S]*?)```/.exec(after);
  if (!fence?.[1]) {
    throw new Error(`sync-content: fence missing after ${rel}`);
  }
  return fence[1].replace(/\n$/, "");
}

/**
 * Replace the fenced TypeScript body immediately after a claimed path.
 *
 * Learn pages normally inherit claims verbatim from four-applications.md.
 * Notes deliberately teaches a wider test excerpt than the canonical spec,
 * so sync replaces that one body with an excerpt read from the live example.
 *
 * @param md - Markdown containing the claimed path
 * @param rel - Claimed path heading
 * @param body - Exact live-source excerpt
 */
function replaceFenceAfterPath(md: string, rel: string, body: string): string {
  const heading = new RegExp(`^### \`${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``, "m");
  const hm = heading.exec(md);
  if (!hm || hm.index === undefined) {
    throw new Error(`sync-content: claimed path missing: ${rel}`);
  }
  const afterHeading = hm.index + hm[0].length;
  const tail = md.slice(afterHeading);
  const fence = /```(?:typescript|ts)?\n[\s\S]*?```/.exec(tail);
  if (!fence || fence.index === undefined) {
    throw new Error(`sync-content: fence missing after ${rel}`);
  }
  const fenceStart = afterHeading + fence.index;
  const fenceEnd = fenceStart + fence[0].length;
  return `${md.slice(0, fenceStart)}\`\`\`typescript\n${body.trim()}\n\`\`\`${md.slice(fenceEnd)}`;
}

/**
 * Claimed teaching fence block (doc-drift visible heading).
 *
 * @param app - Teaching app
 * @param rel - Path under app
 * @param body - Source body
 */
function claimedBlock(app: string, rel: string, body: string): string {
  return [`### \`examples/${app}/${rel}\``, "", "```typescript", body, "```", ""].join("\n");
}

/**
 * Serialize a page with YAML frontmatter.
 *
 * @param page - Page descriptor
 */
function serialize(page: Page): string {
  const desc = page.description ? `description: ${JSON.stringify(page.description)}\n` : "";
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
async function writeMeta(dir: string, meta: Record<string, unknown>): Promise<void> {
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
 * Parse §5 element row (replaces + essence).
 *
 * @param theory - Spec text
 * @param title - Element name
 */
function elementRowParts(theory: string, title: string): { replaces: string; essence: string } {
  const re = new RegExp(`^\\|\\s+\\*\\*${title}\\*\\*\\s+\\|([^|]+)\\|([^|]+)\\|`, "m");
  const m = re.exec(theory);
  if (!m) throw new Error(`sync-content: element row missing: ${title}`);
  return { replaces: m[1]!.trim(), essence: m[2]!.trim() };
}

/**
 * Catalog cells for a Console panel.
 *
 * @param consoleSpec - Console spec text
 * @param title - Panel title
 */
function catalogCells(
  consoleSpec: string,
  title: string,
): { n: string; answers: string; dev: string; prod: string } {
  const re = new RegExp(
    `^\\|\\s+(\\d+)\\s+\\|\\s+\\*\\*${title}\\*\\*([^|]*)\\|([^|]+)\\|([^|]+)\\|([^|]+)\\|`,
    "m",
  );
  const row = re.exec(consoleSpec);
  if (!row) {
    throw new Error(`sync-content: catalog row missing: ${title}`);
  }
  return {
    n: row[1]!,
    answers: row[3]!.trim(),
    dev: row[4]!.trim(),
    prod: row[5]!.trim(),
  };
}

/**
 * Emit a Fumadocs Callout MDX block.
 *
 * @param title - Callout title
 * @param body - Inner markdown (single short sentence preferred)
 */
function calloutBlock(title: string, body: string): string {
  return [`<Callout title="${title}">`, body.trim(), `</Callout>`, ""].join("\n");
}

/**
 * Emit a Fumadocs Cards grid.
 *
 * @param cards - Card specs
 */
function cardsBlock(cards: ReadonlyArray<CardSpec>): string {
  const lines = ["<Cards>"];
  for (const c of cards) {
    const href = c.href ? ` href="${c.href}"` : "";
    lines.push(
      `  <Card title="${escapeAttr(c.title)}" description="${escapeAttr(c.description)}"${href} />`,
    );
  }
  lines.push("</Cards>", "");
  return lines.join("\n");
}

/**
 * Escape double quotes for MDX attribute values.
 *
 * @param s - Raw string
 */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

async function main(): Promise<void> {
  const theory = await readRoot("docs/spec/unified-theory.md");
  const four = await readRoot("docs/spec/four-applications.md");
  const notesTests = await readRoot("examples/notes/tests/notes.test.ts");
  const consoleSpec = await readRoot("docs/spec/console.md");
  const cliDoc = await readRoot("docs/cli.md");
  const agents = await readRoot("AGENTS.md");
  const learnNotesTests = extractBetween(
    notesTests,
    'import { afterEach, expect, test } from "bun:test";',
    'test("search: English and Arabic substring',
  );

  // Preserve hand-authored Get Started MDX (better-auth how-to style).
  await mkdir(OUT, { recursive: true });
  for (const name of [
    "learn",
    "elements",
    "console",
    "ai",
    "index.md",
    "index.mdx",
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
    const canonical = extractBetween(four, app.start, app.end);
    const raw =
      app.slug === "notes"
        ? replaceFenceAfterPath(canonical, "tests/notes.test.ts", learnNotesTests)
        : canonical;
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

  // ── Elements (structured MDX) ────────────────────────────────────────────
  const elementSpecs: ReadonlyArray<{
    slug: string;
    title: string;
    essence: string;
    blurb: string;
    rule: string;
    icon: string;
    drivers?: ReadonlyArray<CardSpec>;
    /** Extra markdown after the drivers cards (e.g. Store `oke db` loop). */
    afterDrivers?: string;
    whyCallout?: string;
    whyCards?: ReadonlyArray<CardSpec>;
    next?: { href: string; label: string };
    fenceApp?: string;
    fenceRel?: string;
  }> = [
    {
      slug: "flow",
      title: "Flow",
      essence: "behavior",
      blurb:
        "Endpoints, jobs, consumers, and workflows are one species. You bind a typed trigger with `on`, declare contracts, and implement `do` through `fx`.",
      rule: "Every backend behavior is a Flow: `on(Trigger) → Effects`. There is one species — not a zoo of endpoints, jobs, and consumers.",
      icon: "Workflow",
      afterDrivers: [
        "## Anatomy of a Flow",
        "",
        "Every Flow — whatever starts it — is the same four declarations plus a `do`. Learn this shape once; only the first line changes across the five trigger types below.",
        "",
        "```typescript",
        "export const createOrder = on(",
        '  http.post("/orders"), // ① trigger — what starts the flow',
        "  flow({",
        "    in: z.object({ sku: z.string(), qty: z.number().int().min(1) }), // ② in — validated input",
        "    out: z.object({ id: z.string() }), // ③ out — typed output",
        "    errors: { OutOfStock: z.object({ left: z.number() }) }, // ④ typed failures, returned not thrown",
        "    do: async (input, fx) => {",
        "      // ⑤ do — the work; every read, write, emit, and call goes through fx",
        "      const [product] = await fx",
        "        .store(db)",
        "        .select()",
        "        .from(products)",
        "        .where(eq(products.sku, input.sku))",
        "        .limit(1);",
        "      if (!product || product.stock < input.qty) {",
        '        return fx.fail("OutOfStock", { left: product?.stock ?? 0 });',
        "      }",
        "      const id = fx.id();",
        "      await fx",
        "        .store(db)",
        "        .insert(orders)",
        '        .values({ id, ...input, status: "pending", createdAt: Date.now() });',
        "      return { id };",
        "    },",
        "  }),",
        ");",
        "```",
        "",
        "## The five triggers",
        "",
        "One law, five ways to start it. Only part ① differs — the `flow({ … })` underneath never changes species. Each type below gets its own section and its own example, written for this page.",
        "",
        "| Trigger | Starts when | Replaces |",
        "| --- | --- | --- |",
        "| `http` | a request arrives | endpoint · handler |",
        "| `signal` | another flow emits | queue consumer |",
        "| `every` (clock) | time passes | cron job |",
        "| store change | a row changes | CDC pipeline |",
        '| — none | another flow calls `fx.call` | "private" helper |',
        "",
        "### 1 · http — a request arrives",
        "",
        "Bind a method and a path. Path params and body validate against `in`; gates evaluate before `do` runs; the return value must match `out`.",
        "",
        "```typescript",
        "export const findOrder = on(",
        '  http.get("/orders/:id").gate(member), // gates sit at the trigger',
        "  flow({",
        "    in: z.object({ id: z.string() }),",
        "    out: z.object({ id: z.string(), status: z.string() }),",
        "    errors: { NotFound: z.object({}) },",
        '    do: async ({ id }, fx) => (await fx.store(db).findById(orders, id)) ?? fx.fail("NotFound", {}),',
        "  }),",
        ");",
        "```",
        "",
        "CRUD is five bindings of that one shape — method and path carry the convention:",
        "",
        "| Operation | Trigger |",
        "| --- | --- |",
        '| create | `http.post("/orders")` |',
        '| list | `http.get("/orders")` |',
        '| get | `http.get("/orders/:id")` |',
        '| update | `http.patch("/orders/:id")` |',
        '| remove | `http.delete("/orders/:id")` |',
        "",
        "A complete working set — create, list with cursor pagination and search, get, update, remove — runs in [Learn · Notes](/docs/learn/notes).",
        "",
        "### 2 · signal — another flow emits",
        "",
        "Declare the signal once — delivery physics is part of the declaration, never guessed:",
        "",
        "```typescript",
        'export const orderPlaced = signal("order-placed", {',
        "  schema: z.object({ orderId: z.string() }),",
        '  delivery: "once", // queue physics: one consumer, retries, DLQ',
        "});",
        "```",
        "",
        "The producer emits through `fx`, transactionally with its writes. The consumer is another Flow — the same species; there is no `subscribe()` and no listener registration:",
        "",
        "```typescript",
        "await fx.emit(orderPlaced, { orderId: id }); // inside the producing flow",
        "",
        "on(",
        "  orderPlaced, // the signal value itself is the trigger",
        "  flow({",
        "    do: async ({ orderId }, fx) =>",
        "      await fx.send(receipt, { to: orderId, data: { orderId } }),",
        "  }),",
        ");",
        "```",
        "",
        "### 3 · clock — time passes",
        "",
        '`every("1h")` is a trigger value, not a registration with a scheduler library.',
        "",
        "```typescript",
        "on(",
        '  every("1h"),',
        "  flow({",
        "    do: (_, fx) => {",
        "      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days",
        "      return fx.store(db).delete(sessions).where(lt(sessions.createdAt, cutoff));",
        "    },",
        "  }),",
        ");",
        "```",
        "",
        "### 4 · store change — a row changes",
        "",
        "CDC is built in. The trigger names a table (and optionally a column); the flow receives `{ before, after }`:",
        "",
        "```typescript",
        "on(",
        '  db.table(orders).changed("status"),',
        "  flow({",
        '    do: ({ before, after }, fx) => fx.log.info("status", { from: before.status, to: after.status }),',
        "  }),",
        ");",
        "```",
        "",
        "### 5 · no trigger — nothing starts it",
        "",
        "Drop `on()` and it is still a real Flow — contracts, effects, and a Manifest entry. Nothing in the world starts it; another flow calls it through `fx.call`:",
        "",
        "```typescript",
        "export const getOrder = flow({ // no on() — not wired to any trigger",
        "  in: z.object({ id: z.string() }),",
        "  out: z.object({ id: z.string(), status: z.string() }),",
        "  do: async ({ id }, fx) => {",
        "    const [order] = await fx.store(db).select().from(orders).where(eq(orders.id, id)).limit(1);",
        "    return order;",
        "  },",
        "});",
        "",
        "// …called from any other flow:",
        "const o = await fx.call(getOrder, { id: orderId });",
        "```",
        "",
        "### How the five harmonize",
        "",
        "Wiring is just values flowing between flows. `createOrder` ends with `await fx.emit(orderPlaced, …)` — and that emission is what starts the consumer. The connection is declared in code, not configured in a dashboard:",
        "",
        "```typescript",
        'on(http.post("/orders"), createOrder); // ① a request arrives',
        "on(orderPlaced, sendReceipt); // ② its emit starts the consumer",
        'on(every("1h"), sweepExpired); // ③ time passes',
        'on(db.table(orders).changed("status"), reverify); // ④ a row changes',
        "// ⑤ getOrder — nothing starts it; every flow above can fx.call it",
        "```",
        "",
        '<Callout title="Registry isolation — tested, not a caveat">',
        'Multiple `oke()` apps in one process are isolated by default: `registry: "consume"` drains the global registry at construction, so a later app cannot inherit this app\'s routes. `"keep"` and `"ignore"` are explicit embedding opt-outs. Tested in `src/kernel/registry-isolation.test.ts`.',
        "</Callout>",
        "",
        "## Query surface through `fx.store(db)`",
        "",
        "`fx.store(db)` is a single-table session. Four capabilities, each shown in use:",
        "",
        "**`.orderBy()` — stable ordering.** Keyset pages order by `(createdAt, id)` so pagination never drifts:",
        "",
        "```typescript",
        "const rows = await fx.store(db).select().from(notes).orderBy(desc(notes.createdAt), desc(notes.id));",
        "```",
        "",
        "**`.limit()` — top-N, with or without `.where()`.** A chained `where → orderBy → limit` issues exactly one SELECT:",
        "",
        "```typescript",
        "const latest = await fx.store(db).select().from(notes).limit(20); // no .where() needed",
        "```",
        "",
        "**`and` / `or` — real parenthesized logic.** Mixed AND/OR at one level is rejected — group explicitly:",
        "",
        "```typescript",
        ".where(or(lt(notes.createdAt, c), and(eq(notes.createdAt, c), lt(notes.id, id))))",
        "// one parenthesized OR — the keyset-cursor predicate",
        "```",
        "",
        "**`like` / `ilike` — search.** Notes uses `like` for the `q` title search; `ilike` is the case-insensitive variant:",
        "",
        "```typescript",
        ".where(like(notes.title, `%${input.q}%`))",
        "```",
        "",
        '<Callout title="Response envelope">',
        "Every Flow returns either data matching `out` — `{ data, error: null }` — or a typed failure via `fx.fail(code, data)` — `{ data: null, error: { code, data, message } }`.",
        "</Callout>",
        "",
        "## Examples",
        "",
        "Three realistic scenarios, taken from the teaching apps. Each names what it is and what follows from its behavior — not just its syntax.",
        "",
        "### A typical endpoint",
        "",
        "Notes' `create` — mounted as part of `store.resource` (`export const create = mounted.create` in `examples/notes/src/flows/notes/index.ts`). The shape is the same `http` trigger shown above; no second snippet is repeated here.",
        "",
        "**Consequence:** `create` answers **201** through `fx.json.create(row)` in `src/elements/store/resource.ts`. A typed failure stays an envelope (`{ data: null, error: … }`) — it never crashes the process.",
        "",
        "### A background job",
        "",
        "Claimed fence from **linkly** — same source the doc-drift gate checks:",
        "",
        "### `examples/linkly/src/flows/links/index.ts`",
        "",
        "```typescript",
        "on(",
        '  every("1h"),',
        "  flow({",
        "    do: (_, fx) => {",
        "      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days",
        "      return fx.store(db).delete(links).where(lt(links.createdAt, cutoff));",
        "    },",
        "  }),",
        ");",
        "```",
        "",
        "**Consequence:** if this flow throws, **only that run fails**. `runPipeline` catches a handler throw into `ctx.error` and does not rethrow (`src/kernel/hooks.ts`); the cron interval keeps firing. The app process does not exit.",
        "",
        "### A durable, multi-step flow",
        "",
        "Claimed fence from **provisions** — same source the doc-drift gate checks:",
        "",
        "### `examples/provisions/src/flows/payments/index.ts`",
        "",
        "```typescript",
        "export const chargeOrder = flow({",
        "  durable: true, // every fx call below is journaled",
        "  in: OrderRef,",
        "  out: z.boolean(),",
        "  do: async ({ orderId }, fx) => {",
        '    const intent = await fx.step("create-intent", () =>',
        "      // never re-runs on replay",
        "      stripe(fx.vault(stripeKey)).create(orderId),",
        "    );",
        "",
        '    await fx.clock.sleep("verify-window", "2m"); // survives restart and deploy',
        "",
        '    return fx.step("confirm", () => stripe(fx.vault(stripeKey)).confirm(intent));',
        "  },",
        "});",
        "```",
        "",
        "**Consequence:** kill the process between the two `fx.step` calls and the run **resumes at `confirm`** — completed steps replay from the journal and never re-run. Proven by `src/elements/clock.test.ts` (`killed mid-execution resumes at the failed step, not the beginning`): after resume, `calls` is `[\"create-intent\", \"confirm\"]` — `create-intent` ran once. The card is not charged twice.",
        "",
        "## Learn more",
        "",
        "- [Signal](/docs/elements/signal) — delivery physics (`once` · `broadcast` · `live`)",
        "- [Clock](/docs/elements/clock) — cron, delay, durable sleep",
        "- [Console · Flows](/docs/console/flows) — the Manifest-derived panel",
        "- [Runs](/docs/console/runs) — how a flow execution is observed",
        "",
        "## See it running",
        "",
        "These snippets are written for this page. The same patterns run end-to-end in the teaching apps — full CRUD with contracts, cursor pagination, and typed errors:",
        "",
        cardsBlock([
          {
            title: "Learn · Notes",
            description: "Full CRUD flows — create, list (cursor + search), get, update, remove.",
            href: "/docs/learn/notes",
          },
          {
            title: "Learn · Linkly",
            description: "One file, four triggers — endpoint, consumer, cron, and callable.",
            href: "/docs/learn/linkly",
          },
        ]),
      ].join("\n"),
      next: { href: "/docs/elements/signal", label: "Signal" },
    },
    {
      slug: "signal",
      title: "Signal",
      essence: "data in motion",
      blurb:
        "Queues, pub/sub, and streams collapse into one Signal. Delivery physics (`once` · `broadcast` · `live`) is mandatory — no silent default.",
      rule: "`delivery` is mandatory with no default. Delivery physics is a semantic decision; guessing it produces silent, expensive bugs.",
      icon: "Radio",
      drivers: [
        {
          title: "memory",
          description: "Dev default — in-process, no extra service.",
        },
        {
          title: "postgres",
          description: "Prod default — transactional with your data.",
        },
        {
          title: "redis",
          description: "Explicit alternative for throughput; outbox relay kept.",
        },
        {
          title: "nats · kafka",
          description: "Explicit high-throughput alternatives.",
        },
      ],
      whyCallout:
        "Queue, pub/sub, and stream were always the same object with different delivery physics — so delivery is an option, not three ecosystems.",
      whyCards: [
        {
          title: "once",
          description: "Queue semantics: competing consumers, retries, DLQ.",
        },
        {
          title: "broadcast",
          description: "Pub/sub: fan-out to every subscriber.",
        },
        {
          title: "live",
          description: "Stream: client-subscribable, replayable.",
        },
      ],
      next: { href: "/docs/elements/store", label: "Store" },
      fenceApp: "linkly",
      fenceRel: "src/flows/links/signals.ts",
    },
    {
      slug: "store",
      title: "Store",
      essence: "data at rest (sql · kv · files · index)",
      blurb:
        "SQL, KV, files, and search index are facets of one Store surface. Drivers are named after protocols, not vendors.",
      rule: "Drivers are named after protocols, not vendors. Vendor choice lives in `images`, keyed by role.",
      icon: "Database",
      drivers: [
        {
          title: "store.sql",
          description: "Dev `sqlite` · prod `postgres` via Bun.sql / bun:sqlite.",
        },
        {
          title: "store.kv",
          description: "Dev `memory` · prod `redis` (protocol, not vendor).",
        },
        {
          title: "store.files",
          description: "Dev `fs` · prod `s3` via Bun.S3.",
        },
        {
          title: "store.index",
          description: "Default `pgvector` — RAG without another service.",
        },
      ],
      afterDrivers: [
        "## store.resource — declarative CRUD + list",
        "",
        "`store.resource(db, table, opts)` expands one declaration into the five ordinary `flow({…})`s of a CRUD resource — list, create, get, update, remove — each still the one species, composed through `fx.store(db)`. Mount all five verbs at once with `on(http.resource(path, resource.all()))`; the return value is the ops bag for `adopt`.",
        "",
        "```typescript",
        "const notesR = store.resource(db, notesTable, {",
        "  in: NewNote,",
        "  out: Note,",
        "  update: NewNote.partial(),",
        "  list: {",
        "    cursor: [notesTable.createdAt, notesTable.id], // keyset columns",
        '    direction: "desc",',
        "    search: [notesTable.title], // ?search= / ?q=",
        '    filter: "all", // ?col=op.value — ColumnScope: "all" | Column[] | "none"',
        '    order: "all", // ?order=col.desc',
        "  },",
        '  unit: "notes",',
        "});",
        "",
        'const mounted = on(http.resource("/notes", notesR.all()));',
        "export const list = mounted.list;",
        "export const create = mounted.create;",
        "export const get = mounted.get;",
        "export const update = mounted.update;",
        "export const remove = mounted.remove;",
        "```",
        "",
        "The list URL is the whole query — `?cursor=` / `?offset=` / `?limit=` paginate (keyset when `cursor` columns are set, else offset), `?search=` runs a substring match over `search` columns, `?col=op.value` filters (PostgREST ops `eq ne gt gte lt lte like ilike in is`), `?order=col.asc,other.desc` orders, and `?select=id,title` projects. Values are UTF-8 — English, Arabic, any language round-trips. `list` answers the Stripe envelope `{ data, meta: { nextCursor, hasNextPage }, error: null }`; `create` answers 201; `remove` 204; `get` / `update` / `remove` return a typed `NotFound`.",
        "",
        "## Examples",
        "",
        "Three realistic list configurations. One is a teaching-app claimed fence; the other two are typechecked against the real API and labeled as such.",
        "",
        "### An admin table",
        "",
        "```typescript",
        'list: { mode: "offset", count: "exact", limit: 20 },',
        "```",
        "",
        "*Illustrative configuration, type-checked against the real API (`src/elements/store/resource-list-docs.fixture.ts`) — not run in a teaching app.*",
        "",
        '**Consequence:** with `count: "exact"` (the offset default), list runs `COUNT(*)` via `store.count` (`src/elements/store/resource.ts`) to fill `meta.total`. On a huge table that count is the cost — set `count: "none"` to skip `meta.total` and return only `meta.offset`.',
        "",
        "### An infinite feed",
        "",
        "Claimed fence from **notes** — same source the doc-drift gate checks:",
        "",
        "### `examples/notes/src/flows/notes/index.ts`",
        "",
        "```typescript",
        "const notesR = store.resource(db, notesTable, {",
        "  in: NewNote,",
        "  out: Note,",
        "  update: NewNote.partial(),",
        "  list: {",
        "    cursor: [notesTable.createdAt, notesTable.id],",
        '    direction: "desc",',
        "    limit: 20,",
        "    maxLimit: 100,",
        "    search: [notesTable.title],",
        '    filter: "all",',
        '    order: "all",',
        "  },",
        '  unit: "notes",',
        "  breaking: true,",
        "});",
        "```",
        "",
        "**Consequence:** keyset (cursor) paging is the default when `cursor` columns are set (`src/elements/store/resource.ts`) — it stays stable under concurrent inserts, while offset pages shift when rows are inserted ahead of the window. That is why cursor is the default; Notes' test asserts pages \"never overlap or skip rows\" (`examples/notes/tests/notes.test.ts`).",
        "",
        "### A public, restricted endpoint",
        "",
        "```typescript",
        'list: { mode: "offset", filter: "none", limit: 20 },',
        "```",
        "",
        "*Illustrative configuration, type-checked against the real API (`src/elements/store/resource-list-docs.fixture.ts`) — not run in a teaching app.*",
        "",
        '**Consequence:** a request that filters on a forbidden column — e.g. `?secret=eq.x` — fails with **422** and a `ValidationError` whose message is exactly `unknown list param "secret"` (`badInput` in `src/elements/store/resource.ts` when `filter === "none"`).',
        "",
        "## Domain schema — declare → generate",
        "",
        "Recommended path: declare tables with `store.schema.table` + `field.*` (ORM-agnostic), then let `oke db` emit dialect-specific Drizzle before sync.",
        "",
        "```typescript",
        'import { store, field, id, now } from "okengine";',
        "",
        'export const notes = store.schema.table("notes", {',
        "  id: field.text().primaryKey().defaultFn(id),",
        "  title: field.text().notNull(),",
        "  body: field.text().notNull().pii(),",
        "  createdAt: field.integer().notNull().defaultFn(now),",
        "});",
        "",
        'export const db = store.sql("notes", { schema: { notes } });',
        "```",
        "",
        "Put declarations in `src/schema.decl.ts` (or set `db.declare` in `oke.config.ts`). `oke db push|generate|migrate` emits `src/schema.generated.ts` (`sqliteTable` or `pgTable` from `drivers.store.sql`) and then runs drizzle-kit as today. Point `drizzle.config.ts` `schema` at the generated file.",
        "",
        "**Escape hatch:** hand-written Drizzle `src/schema.ts` remains supported. If there is nothing to emit (no declare module and no plugged plugin tables), emit is skipped and Prompt 42 / OKE1101 / docker-prod never-auto-DDL are unchanged.",
        "",
        "v1 field primitives: `field.text` · `field.integer`, plus `.primaryKey()` · `.notNull()` · `.unique()` · `.default(v)` · `.defaultFn(fn)` · `.pii()` · `.sensitive()` · `.retain(duration)` · `.as(sqlName)` · `.references()`.",
        "",
        "### Foreign keys and relations",
        "",
        "<Cards>",
        '  <Card title=".references()" description="Dialect-agnostic FK on a field — emitted as Drizzle `.references(() => table.col)` for sqlite and postgres." />',
        '  <Card title="store.schema.relations" description="Mirrors drizzle-orm `defineRelations` (`r.one.*` / `r.many.*` + `from` / `to`) — emitted into the same generated file." />',
        '  <Card title="Per dialect" description="Same pre-step: `sqliteTable` / `pgTable` with FK chains, then `defineRelations(...)` when relations are declared." />',
        "</Cards>",
        "",
        "| API | Shape |",
        "| --- | --- |",
        "| `field.*.references` | `(ref, actions?) => FieldBuilder` — lazy `() => links.code`; optional `{ onDelete, onUpdate }` |",
        "| `store.schema.relations` | `(tables, (r) => config) => SchemaRelationsDecl` — same shape as `defineRelations` |",
        "",
        '<Callout title="Many-to-many">',
        "A junction table with two foreign keys plus two `one` / `many` relations composes many-to-many. There is no separate many-to-many API and no `.through()` — the junction is an ordinary table.",
        "</Callout>",
        "",
        '<Callout title="No relational with: through fx">',
        "Relational `with:` — Drizzle RQB `db.query.*.findMany({ with: … })` — is **not supported** through `fx`. `fx.store` is a single-table session: effect inference, cache keys, and PII masking each assume one table per call, and declared relations (`store.schema.relations`, emitted as `defineRelations`) are schema metadata for drizzle-kit, not an `fx` handle. Compose with separate single-table `fx.store` reads (or `fx.call`) so each table appears explicitly in Manifest `reads` / `writes`.",
        "</Callout>",
        "",
        "### Plugin tables (known v1 limit)",
        "",
        "Plugins may declare **additional whole tables** (with `field.*` columns) that merge into the generated domain schema. At emit time `oke db` loads the live app entry (`src/app.ts`, or `db.entry` / `package.json` `okengine.entry`) and merges `app.plugins.tableContributions()` alongside app decls — the same file drizzle-kit then syncs. Extending an existing app-owned table with plugin columns is **not** supported in v1 — contribute a separate table instead (e.g. `two_factor_credentials` keyed by `userId`, not ALTER-style columns on `users`).",
        "",
        "## Domain schema sync (`oke db`)",
        "",
        "Domain schema is synced with **drizzle-kit** — not a hand-rolled migrator. Abstract decls (above) emit into that same loop; there is no third schema CLI.",
        "",
        "| Command | When |",
        "| --- | --- |",
        "| `oke db push` | Dev — apply schema to the live local DB (no migration files) |",
        "| `oke db generate` | Write versioned SQL under `drizzle/` for review |",
        "| `oke db migrate` | Explicitly apply those files (human or CI — never boot-time) |",
        "",
        "`oke dev` (local) auto-runs `oke db push` when `schema.ts` / `schema.decl.ts` / `app.ts` changes. Opt out with `--no-db-push` or `db: { autoPush: false }` in `oke.config.ts`. Docker/prod never auto-push; a missing table surfaces as **OKE1101** → run `oke db migrate`.",
        "",
        "This is **not** `oke schema generate`, which only emits core/plugin stub handles into `schema/oke.ts`.",
        "",
        "## Learn more",
        "",
        "- [Domain schema — declare → generate](/docs/elements/store#domain-schema--declare--generate) — declare tables, then `oke db` emits Drizzle",
        "- [Console · Store](/docs/console/store) — browse sql/kv/files/index; cache keys; PII masking",
        "- [CLI Reference](/docs/cli) — `oke db push` / `generate` / `migrate`",
        "",
      ].join("\n"),
      next: { href: "/docs/elements/clock", label: "Clock" },
      fenceApp: "linkly",
      fenceRel: "src/schema.decl.ts",
    },
    {
      slug: "clock",
      title: "Clock",
      essence: "time",
      blurb:
        "Cron, delay, timeout, durable sleep, and TTL — time as an element, not a bolted-on scheduler library.",
      rule: "Clock defaults to `postgres` — durability needs transactional storage.",
      icon: "Clock",
      drivers: [
        {
          title: "postgres",
          description: "Default — durable schedules and wakes.",
        },
        {
          title: "every / delay / sleep",
          description: "Cron, delay, timeout, durable sleep, TTL.",
        },
      ],
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
      rule: "Permission sits at the trigger. Auth is built-in (hybrid session, argon2id) with zero-config defaults.",
      icon: "ShieldCheck",
      drivers: [
        {
          title: "auth",
          description: "Built-in hybrid session; alternatives via protocol adapters.",
        },
        {
          title: "rate limit",
          description: "Default `sliding-window-counter`.",
        },
        {
          title: "ABAC · flags",
          description: "Permission, quota, and feature-flag gates.",
        },
      ],
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
      rule: "Secrets are write-only in the Console — set and rotate, never reveal. Flows read via `fx.vault`.",
      icon: "KeyRound",
      drivers: [
        {
          title: ".env.local",
          description: "Dev default — local files, no invented format.",
        },
        {
          title: "sops / age",
          description: "Prod default — existing standard.",
        },
      ],
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
      rule: "Reaching a human has physics Signal cannot express: consent, locale, receipts, and fallback chains.",
      icon: "Mail",
      drivers: [
        {
          title: "channel.email",
          description: "Dev `console` inbox · prod `smtp`.",
        },
        {
          title: "SMS · WhatsApp · push",
          description: "Human mediums with consent and fallback chains.",
        },
      ],
      whyCallout:
        "Channel is an element because human reach has irreducible physics — consent, locale, receipts — that machine messaging does not.",
      whyCards: [
        {
          title: "consent",
          description: "Opt-out and suppression are first-class.",
        },
        {
          title: "locale",
          description: "Localized templates and resolution chains.",
        },
        {
          title: "fallback",
          description: "Cross-medium chains recorded as chains, not outcomes.",
        },
      ],
      next: { href: "/docs/elements/ai", label: "AI" },
      fenceApp: "provisions",
      fenceRel: "src/channels.ts",
    },
    {
      slug: "ai",
      title: "AI",
      essence: "reaching machine intelligence",
      blurb:
        "Models, prompts, agents, and RAG earn an element slot: non-determinism, cost, versioned prompts, egress privacy, and different test physics.",
      rule: "Prod model choice is never guessed — must be declared. Dev uses `mock` for determinism. AI + `pii` is denied unless `allowPii`.",
      icon: "Bot",
      drivers: [
        {
          title: "mock",
          description: "Dev default — deterministic tests.",
        },
        {
          title: "declared provider",
          description: "Prod: Anthropic · openai-compatible · Bedrock · Vertex · Ollama.",
        },
      ],
      whyCallout:
        "Channel reaches humans; AI reaches machine intelligence. Neither can be expressed by Store or Signal alone.",
      whyCards: [
        {
          title: "non-determinism",
          description: "Different test physics than ordinary effects.",
        },
        {
          title: "cost",
          description: "Price per call is a first-class dimension.",
        },
        {
          title: "egress",
          description: "PII governance enforced at build time.",
        },
      ],
      next: { href: "/docs/learn/notes", label: "Learn · Notes" },
      fenceApp: "skyport",
      fenceRel: "src/ai.ts",
    },
  ];

  for (const el of elementSpecs) {
    const row = elementRowParts(theory, el.title);
    const parts = [
      `${el.title} is the element for **${el.essence}**.`,
      "",
      el.blurb,
      "",
      calloutBlock("Governing rule", el.rule),
      "## At a glance",
      "",
      cardsBlock([
        {
          title: el.title,
          description: `Essence: ${row.essence}. Replaces: ${row.replaces}.`,
        },
      ]),
      el.drivers ? ["## Drivers available", "", cardsBlock([...el.drivers])].join("\n") : "",
      el.afterDrivers ?? "",
      el.whyCallout
        ? [
            "## Why this is an element",
            "",
            calloutBlock("Why", el.whyCallout),
            el.whyCards ? cardsBlock([...el.whyCards]) : "",
          ].join("\n")
        : "",
      el.fenceApp && el.fenceRel
        ? [
            "## Example from the teaching apps",
            "",
            `Claimed fence from **${el.fenceApp}** — same source the doc-drift gate checks:`,
            "",
            claimedBlock(el.fenceApp, el.fenceRel, readFenceAfterPath(four, el.fenceRel)),
          ].join("\n")
        : "",
      el.next
        ? [
            "## Next",
            "",
            cardsBlock([
              {
                title: el.next.label,
                description: `Continue to ${el.next.label}.`,
                href: el.next.href,
              },
              {
                title: "Introduction",
                description: "Eight elements overview.",
                href: "/docs/get-started/introduction",
              },
              {
                title: "Console",
                description: "Panels derived from the Manifest.",
                href: "/docs/console/overview",
              },
            ]),
          ].join("\n")
        : "",
    ];
    pages.push({
      path: `elements/${el.slug}.mdx`,
      title: el.title,
      description: `${el.essence} — ${el.blurb}`,
      icon: el.icon,
      source: "docs/spec/unified-theory.md",
      body: parts.join("\n").replace(/\n{3,}/g, "\n\n"),
    });
  }

  // ── Console panels (structured MDX) ──────────────────────────────────────
  const consolePanels: ReadonlyArray<{
    slug: string;
    title: string;
    icon: string;
    description: string;
    rule: string;
    shows: ReadonlyArray<CardSpec>;
    conditional?: boolean;
  }> = [
    {
      slug: "overview",
      title: "Overview",
      icon: "Activity",
      description: "Is the system healthy right now?",
      rule: "Built on declared objectives — burn rate and ranked findings, not a wall of charts nobody reads.",
      shows: [
        {
          title: "Declared SLOs",
          description:
            "Objectives enter the Manifest; lowering a target is a reviewable code change.",
        },
        {
          title: "Burn rate",
          description:
            "Error rate over tolerable rate — pages and investigates with clear thresholds.",
        },
        {
          title: "Journeys",
          description:
            "Causal paths, not service lists — impossible compositions rejected at compile.",
        },
        {
          title: "Ranked findings",
          description:
            "Union of panel findings: user harm first, then irreversibility, then trend.",
        },
      ],
    },
    {
      slug: "flows",
      title: "Flows",
      icon: "GitBranch",
      description: "What exists; call it; read its contract.",
      rule: "Renders the one law as three columns: `Causes ← Flows → Effects` — not a tree.",
      shows: [
        {
          title: "Causes column",
          description: "Triggers and callers — what runs this.",
        },
        {
          title: "Flows column",
          description: "Context-adaptive centre with contracts and invoke.",
        },
        {
          title: "Effects column",
          description: "What changes — store, signal, channel, AI, vault.",
        },
        {
          title: "Flow drawer",
          description: "Workshop peek/expand — save as bun:test from a real response.",
        },
      ],
    },
    {
      slug: "signals",
      title: "Signals",
      icon: "Radio",
      description: "Queue depth, in-flight, DLQ, live monitors.",
      rule: "One list grouped by delivery physics — not three tabs that re-split the element.",
      shows: [
        {
          title: "once",
          description: "Pending, in-flight, DLQ, retry policy.",
        },
        {
          title: "broadcast",
          description: "Per-subscriber lag and targeted replay.",
        },
        {
          title: "live",
          description: "Connection count, throughput, payload monitor.",
        },
        {
          title: "DLQ repair",
          description: "Schema form, typed errors, causal chain, dry-run bulk replay.",
        },
      ],
    },
    {
      slug: "store",
      title: "Store",
      icon: "Database",
      description: "Browse sql/kv/files/index; cache keys; replica lag.",
      rule: "The most dangerous panel in production — gates, tenant isolation, PII masking, and audit on the data path.",
      shows: [
        {
          title: "Four facets",
          description: "sql · kv · files · index with adaptive detail.",
        },
        {
          title: "PII masking",
          description: "Follows schema classification, including raw SQL.",
        },
        {
          title: "Cache keys",
          description: "Which read produced a key; which write invalidates it.",
        },
        {
          title: "Direct edit warning",
          description: "Names what will not happen — not a silent row patch.",
        },
      ],
    },
    {
      slug: "clock",
      title: "Clock",
      icon: "Clock",
      description: "Upcoming crons, sleeping durable flows, journal.",
      rule: "Looks like time — a forward timeline for schedules and pending wakes, not a flat grid.",
      shows: [
        {
          title: "Schedules",
          description: "Recurring crons with drift, overdue, catch-up, lease holder.",
        },
        {
          title: "Pending wakes",
          description: "Every sleeping durable flow and when it wakes.",
        },
        {
          title: "DST warnings",
          description: "Only when the schedule falls in an ambiguous window.",
        },
        {
          title: "Actions",
          description: "Run now, wake early, pause, edit when overridable.",
        },
      ],
    },
    {
      slug: "gates",
      title: "Gates",
      icon: "Shield",
      description: "Permission matrix, rate counters, MFA map.",
      rule: "Refuse the giant roles×permissions matrix as the entry point — inquire from principal or from flow.",
      shows: [
        {
          title: "Simulator",
          description: "Gate chain in evaluation order — where a 403 stopped.",
        },
        {
          title: "Unguarded flows",
          description: "Continuous audit: public user-plane flows after deploy.",
        },
        {
          title: "Deploy diff",
          description: "Permission widening caught from Manifest Diff.",
        },
        {
          title: "Plane separation",
          description: "Operator holding an application scope is a violation.",
        },
      ],
    },
    {
      slug: "vault",
      title: "Vault",
      icon: "KeyRound",
      description: "Secret contracts, who can read each, rotation due.",
      rule: "Secrets are write-only — the panel can set and rotate; it can never reveal.",
      shows: [
        {
          title: "Fingerprints",
          description: "Salted hash per environment — rotation and drift without exposure.",
        },
        {
          title: "Resolution chain",
          description: "Which source won: env, files, vault driver, or fallback.",
        },
        {
          title: "Who can read",
          description: "Derived from effects that declare `fx.vault`.",
        },
        {
          title: "Rotation blast radius",
          description: "In-flight durable runs that wake with a new key.",
        },
      ],
    },
    {
      slug: "channels",
      title: "Channels",
      icon: "Mailbox",
      description: "Templates, delivery receipts, bounces, opt-outs.",
      rule: "Suppression is not failure — the taxonomy of “did not arrive” has seven states with verdicts.",
      shows: [
        {
          title: "Dev inbox",
          description: "`console` driver lands every medium locally.",
        },
        {
          title: "Deliverability",
          description: "SPF/DKIM/DMARC, bounces, complaints, suppression list.",
        },
        {
          title: "Fallback chains",
          description: "Recorded as chains (e.g. WhatsApp → SMS), not single outcomes.",
        },
        {
          title: "Locale previews",
          description: "Template data bound to schema; RTL-accurate previews.",
        },
      ],
    },
    {
      slug: "ai",
      title: "AI",
      icon: "Sparkles",
      description: "Prompt versions, eval scores, cost, agent runs.",
      rule: "Everything else in the Console is deterministic; this panel is built on distributions, not single values.",
      shows: [
        {
          title: "Prompt versions",
          description: "A version bump is Manifest Diff blast radius.",
        },
        {
          title: "Eval + shape",
          description: "Schema-validation failure is its own class.",
        },
        {
          title: "Agent tools",
          description: "Tools are the app’s own flows — undeclared reach is denied and shown.",
        },
        {
          title: "Budgets",
          description: "Cost, semantic cache, and `allowPii` as standing review surfaces.",
        },
      ],
    },
    {
      slug: "architecture",
      title: "Architecture",
      icon: "Network",
      description: "How it all connects — the diagram that is the code.",
      rule: "Flows answers “which one”; Architecture answers “what shape”. Never shows the whole system by default.",
      shows: [
        {
          title: "Unit clusters",
          description: "Default aggregated edges; focus one or two hops.",
        },
        {
          title: "Element layers",
          description: "Toggle data, messaging, time, external edges.",
        },
        {
          title: "Live traffic",
          description: "Edge thickness from real traffic; dashed = never traversed.",
        },
        {
          title: "Pathologies",
          description: "Cycles, god nodes, orphan signals, SPOFs — computed from the graph.",
        },
      ],
    },
    {
      slug: "traces",
      title: "Traces",
      icon: "Route",
      description: "One timeline across http → store → signal → durable steps.",
      rule: "Folded time across async boundaries — a seven-day sleep is not 99.99% empty waterfall.",
      shows: [
        {
          title: "Causal chain",
          description: "Join parent/child across emit boundaries.",
        },
        {
          title: "Effect tiers",
          description: "Spans coloured by the same vocabulary as Flows.",
        },
        {
          title: "Filter by effect",
          description: "Everything that wrote a table, sent mail, or cost more than X.",
        },
        {
          title: "Why slow / why fail",
          description: "Critical path highlight; open on the failing span.",
        },
      ],
    },
    {
      slug: "runs",
      title: "Runs",
      icon: "Play",
      description: "Wide events — one record per flow execution.",
      rule: "One flow execution = one wide event = one span. Analysis by dimension, not a text search box.",
      shows: [
        {
          title: "Wide events",
          description: "Dimensions from effects — no manual instrumentation tax.",
        },
        {
          title: "Outlier explanation",
          description: "Compare all dimensions between slow and baseline populations.",
        },
        {
          title: "Storage tiers",
          description: "Default Parquet + DuckDB; optional postgres / clickhouse.",
        },
        {
          title: "Lifecycle",
          description: "Retain by default; redaction and crypto-shredding for compliance.",
        },
      ],
    },
    {
      slug: "manifest-diff",
      title: "Manifest Diff",
      icon: "Diff",
      description: "Blast radius of a deploy: new effects, widened permissions.",
      rule: "Compares meaning rather than lines — behaviour change, sorted by blast radius.",
      shows: [
        {
          title: "Contract breaking",
          description: "Existing clients will fail.",
        },
        {
          title: "Permission widening",
          description: "Attack surface grew — gate removed or scope widened.",
        },
        {
          title: "Effect widening",
          description: "New write, external effect, or secret read.",
        },
        {
          title: "CI gate",
          description: "Blocks undeclared breaks; intended breaks need `breaking: true`.",
        },
      ],
    },
    {
      slug: "access",
      title: "Access",
      icon: "Users",
      description: "Identities, roles, API keys.",
      rule: "Granting an application scope to an operator is impossible in the UI — taught by absence, not refusal.",
      shows: [
        {
          title: "Two planes",
          description: "Operators and application users never mix.",
        },
        {
          title: "Key creation",
          description: "Value shown once; attenuation to creator scopes only.",
        },
        {
          title: "Revocation",
          description: "Blast radius plus honest JWT validity delay.",
        },
        {
          title: "Hygiene",
          description: "Unused keys, never-signed-in operators, expired invites.",
        },
      ],
    },
    {
      slug: "plugins",
      title: "Plugins",
      icon: "Puzzle",
      description: "Installed plugins and their contributed panels.",
      rule: "Scope is the attachment point — `app.plug()` / `unit.plug()` / `flow.plug()`. The Console never installs anything.",
      shows: [
        {
          title: "Origin × state",
          description: "Core / Local / Community; state derived from code, not a flag.",
        },
        {
          title: "Declares vs intercepts",
          description: "Boot contributions vs per-request hooks with measured cost.",
        },
        {
          title: "Supply chain",
          description: "No lifecycle scripts; capability widening hits Manifest Diff.",
        },
        {
          title: "Install path",
          description: "Shows state and hands you the command — no browser install.",
        },
      ],
    },
    {
      slug: "privacy",
      title: "Privacy",
      icon: "EyeOff",
      description: "Where PII lives, who touches it, export/erase (conditional).",
      rule: "Conditional panel — appears when the privacy plugin is plugged. Catalog row is the durable reference.",
      shows: [
        {
          title: "PII map",
          description: "Where personal data lives and who touches it.",
        },
        {
          title: "Export / erase",
          description: "`oke privacy export|erase --subject` across stores.",
        },
      ],
      conditional: true,
    },
    {
      slug: "tenancy",
      title: "Tenancy",
      icon: "Building2",
      description: "Per-tenant usage, limits, isolation checks (conditional).",
      rule: "Conditional panel — appears when the tenancy plugin is plugged. Catalog row is the durable reference.",
      shows: [
        {
          title: "Usage & limits",
          description: "Per-tenant usage and configured limits.",
        },
        {
          title: "Isolation",
          description: "Checks that tenant boundaries hold.",
        },
      ],
      conditional: true,
    },
  ];

  for (const panel of consolePanels) {
    const cells = catalogCells(consoleSpec, panel.title);
    const parts = [
      `Answers: **${cells.answers}**`,
      "",
      calloutBlock("Governing rule", panel.rule),
      "## What this panel shows",
      "",
      cardsBlock([...panel.shows]),
      "## Catalog",
      "",
      cardsBlock([
        {
          title: `Dev`,
          description: cells.dev,
        },
        {
          title: `Prod`,
          description: cells.prod,
        },
      ]),
      panel.conditional
        ? calloutBlock(
            "Conditional",
            "This panel appears when the optional core plugin is plugged. There is no separate detailed subsection beyond the catalog row.",
          )
        : "",
    ];
    pages.push({
      path: `console/${panel.slug}.mdx`,
      title: panel.title,
      description: panel.description,
      icon: panel.icon,
      source: "docs/spec/console.md",
      body: parts.join("\n").replace(/\n{3,}/g, "\n\n"),
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
      extractBetween(theory, "## 14. Plugins — the extensibility law", "## 15. The Console"),
    ),
  });

  const cliFromFour = demoteHeadings(extractBetween(four, "## Commands", "## The Console at"));
  // docs/cli.md is H1-titled; strip that title and demote the rest under four-apps Commands.
  const cliFromDocs = demoteHeadings(
    cliDoc.replace(/^# CLI\n+/, "").replace(/^Everyday[\s\S]*?(?=## )/, ""),
  );

  pages.push({
    path: "cli.md",
    title: "CLI Reference",
    description: "oke and create-oke — everyday commands and flags.",
    icon: "Terminal",
    source: "docs/cli.md",
    body: [cliFromFour, "", cliFromDocs].join("\n"),
  });

  pages.push({
    path: "security.md",
    title: "Security",
    description: "Console security posture — DNS rebinding, XSS, MCP.",
    icon: "Shield",
    source: "docs/spec/console.md",
    body: demoteHeadings(
      extractBetween(consoleSpec, "## 10. Security posture", "## 11. Cross-cutting behaviour"),
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

  // ── Docs index (section Cards) ───────────────────────────────────────────
  pages.push({
    path: "index.mdx",
    title: "Documentation",
    description: "One law. Eight elements. Ten exports.",
    icon: "BookOpen",
    source: "docs/spec/unified-theory.md",
    body: [
      "Welcome to the okengine handbook. Pick a section below — or start with Get Started if you are new.",
      "",
      calloutBlock(
        "The one law",
        "Every backend behavior is a Flow: `on(Trigger) → Effects`. One species; triggers are typed values.",
      ),
      "```ts",
      'on(http.post("/bookings"), createBooking);',
      'on(every("10m"), expireStale);',
      "on(orderPlaced, sendReceipt);",
      "```",
      "",
      "## Browse by section",
      "",
      cardsBlock([
        {
          title: "Get Started",
          description: "One law → install → first flows.",
          href: "/docs/get-started/introduction",
        },
        {
          title: "Learn",
          description: "Progressive teaching apps: Notes → Skyport.",
          href: "/docs/learn/notes",
        },
        {
          title: "Elements",
          description: "Flow → AI reference, one page each.",
          href: "/docs/elements/flow",
        },
        {
          title: "Console",
          description: "Seventeen Manifest-derived panels.",
          href: "/docs/console/overview",
        },
        {
          title: "Plugins",
          description: "The extensibility law — public plugin API only.",
          href: "/docs/plugins",
        },
        {
          title: "CLI Reference",
          description: "`oke` and `create-oke` everyday commands.",
          href: "/docs/cli",
        },
        {
          title: "Security",
          description: "Console security posture — Host, Origin, MCP.",
          href: "/docs/security",
        },
        {
          title: "AI Resources",
          description: "AGENTS.md, MCP `:6535`, `/llms.txt`.",
          href: "/docs/ai/resources",
        },
      ]),
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
      "get-started",
      "elements",
      "console",
      "learn",
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
    pages: ["flow", "signal", "store", "clock", "gate", "vault", "channel", "ai"],
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
