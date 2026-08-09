/**
 * Versioned codemod registry — ships with every breaking change (§22).
 *
 * `oke upgrade` runs every applicable transform and prints a diff.
 * Adding a breaking change without a codemod is a process defect; the
 * registry is the checklist.
 *
 * Environment-model migrations (`local`/`docker` → `dev`, sqlite removal)
 * are documented only — see site docs `reference/migrating-environments`.
 * No soft-compat rewriter for those.
 */

import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** One file rewrite produced by a codemod. */
export interface CodemodChange {
  /** Path relative to the project root. */
  readonly path: string;
  /** Original file contents. */
  readonly before: string;
  /** Transformed file contents. */
  readonly after: string;
}

/** One registered breaking-change transform. */
export interface Codemod {
  /** Stable id (e.g. `0.1.0-rename-fx-ask`). */
  readonly id: string;
  /** Semver range this applies when upgrading from. */
  readonly from: string;
  /** Semver this lands in. */
  readonly to: string;
  /** One-line description for `oke upgrade` output. */
  readonly description: string;
  /**
   * Apply the transform.
   *
   * @param cwd - Project root
   */
  readonly apply: (cwd: string) => Promise<readonly CodemodChange[]>;
}

/**
 * Collect TypeScript sources under `src` / `app`.
 *
 * @param cwd - Project root
 */
async function collectVaultCandidates(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const roots = ["src", "app"];
  for (const root of roots) {
    const dir = resolve(cwd, root);
    try {
      await walkTs(dir, out);
    } catch {
      // missing dir
    }
  }
  return out;
}

/**
 * @param dir - Directory
 * @param out - Accumulator of absolute paths
 */
async function walkTs(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walkTs(path, out);
    } else if (entry.isFile() && /\.(ts|mts|tsx)$/.test(entry.name)) {
      out.push(path);
    }
  }
}

/**
 * Rewrite deep `okengine` imports that left the thin root to subpaths.
 *
 * @param source - File contents
 */
export function rewriteThinRootImports(source: string): string {
  const movers: readonly { readonly names: readonly string[]; readonly from: string }[] = [
    {
      names: [
        "createRunsRuntime",
        "collectWideEvent",
        "createRunTelemetry",
        "explainOutliers",
        "filesRunsDriver",
        "memoryRunsDriver",
        "postgresRunsDriver",
        "clickhouseRunsDriver",
        "openDuckDB",
        "duckQuery",
      ],
      from: "okengine/runs",
    },
    {
      names: [
        "createJournal",
        "createMemoryJournalStore",
        "createFileJournalStore",
        "hasJournalLease",
        "JOURNAL_DEFAULT_LEASE_MS",
      ],
      from: "okengine/journal",
    },
    {
      names: ["compileAot", "compileDynamic", "compileRoute", "sucrose", "extractManifest"],
      from: "okengine/compiler",
    },
    {
      names: ["formatMessage", "clearMessageFormatCache", "resolveFailureMessage"],
      from: "okengine/i18n",
    },
    {
      names: [
        "bootApplication",
        "mintCapabilities",
        "createFx",
        "createRouter",
        "CONSOLE_PORT",
        "MCP_PORT",
      ],
      from: "okengine/full",
    },
  ];

  let text = source;
  for (const mover of movers) {
    const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*(["'])okengine\\2`, "g");
    text = text.replace(re, (full, body: string, quote: string) => {
      const parts = body
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const keep: string[] = [];
      const move: string[] = [];
      for (const part of parts) {
        const base =
          part
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0]
            ?.trim() ?? part;
        if (mover.names.includes(base)) move.push(part);
        else keep.push(part);
      }
      if (move.length === 0) return full;
      const lines: string[] = [];
      if (keep.length > 0) {
        lines.push(`import { ${keep.join(", ")} } from ${quote}okengine${quote}`);
      }
      lines.push(`import { ${move.join(", ")} } from ${quote}${mover.from}${quote}`);
      return lines.join(";\n");
    });
  }
  return text;
}

export const CODEMODS: readonly Codemod[] = [
  {
    id: "0.10.3-thin-root-subpaths",
    from: "0.10.2",
    to: "0.10.3",
    description:
      "Move deep okengine imports (runs/journal/compiler/i18n/boot helpers) to okengine/* subpaths after thin root",
    async apply(cwd) {
      const changes: CodemodChange[] = [];
      for (const path of await collectVaultCandidates(cwd)) {
        const before = await Bun.file(path).text();
        const after = rewriteThinRootImports(before);
        if (after !== before) {
          changes.push({
            path: relative(cwd, path) || path,
            before,
            after,
          });
        }
      }
      return changes;
    },
  },
];

/**
 * Validate the registry (unique ids, non-empty metadata, apply present).
 *
 * @param registry - Codemods to validate (defaults to {@link CODEMODS})
 */
export function validateCodemodRegistry(
  registry: readonly Codemod[] = CODEMODS,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const mod of registry) {
    if (!mod.id.trim()) errors.push("codemod missing id");
    else if (seen.has(mod.id)) errors.push(`duplicate codemod id: ${mod.id}`);
    else seen.add(mod.id);
    if (!mod.from.trim()) errors.push(`${mod.id}: missing from`);
    if (!mod.to.trim()) errors.push(`${mod.id}: missing to`);
    if (!mod.description.trim()) errors.push(`${mod.id}: missing description`);
    if (typeof mod.apply !== "function") {
      errors.push(`${mod.id}: apply must be a function`);
    }
  }
  return errors;
}

/**
 * Run every registered codemod and collect file rewrites.
 *
 * @param cwd - Project root
 * @param registry - Codemods (defaults to {@link CODEMODS})
 */
export async function runCodemods(
  cwd: string,
  registry: readonly Codemod[] = CODEMODS,
): Promise<readonly CodemodChange[]> {
  const out: CodemodChange[] = [];
  for (const mod of registry) {
    const changes = await mod.apply(cwd);
    out.push(...changes);
  }
  return out;
}
