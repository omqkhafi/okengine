/**
 * Flattened slash-command catalogue — TUI jumps + full `oke` CLI surface.
 */

import { OKE_COMMANDS, type CliCommand } from "../registry.ts";

/** Kind of slash action. */
export type SlashKind = "panel" | "cli";

/** One autofill / runnable slash entry. */
export type SlashAction = {
  /** Canonical command after `/` (e.g. `db push`, `dev`, `panel dashboard`). */
  readonly id: string;
  /** Display label (usually same as id). */
  readonly label: string;
  readonly summary: string;
  readonly kind: SlashKind;
  /** Args after `oke` for CLI actions. */
  readonly argv?: readonly string[];
  /** Panel id for TUI jumps. */
  readonly panel?: string;
};

const PANEL_JUMPS: readonly SlashAction[] = [
  {
    id: "panel dashboard",
    label: "panel dashboard",
    summary: "Jump to Dashboard",
    kind: "panel",
    panel: "dashboard",
  },
  {
    id: "panel dev",
    label: "panel dev",
    summary: "Jump to Dev",
    kind: "panel",
    panel: "dev",
  },
  {
    id: "panel database",
    label: "panel database",
    summary: "Jump to Database",
    kind: "panel",
    panel: "database",
  },
  {
    id: "panel docker",
    label: "panel docker",
    summary: "Jump to Docker",
    kind: "panel",
    panel: "docker",
  },
  {
    id: "panel navigator",
    label: "panel navigator",
    summary: "Jump to Navigator",
    kind: "panel",
    panel: "navigator",
  },
];

/**
 * Expand a registry command into slash actions (leaf + each subcommand).
 *
 * @param cmd - Registry command
 */
function expandCommand(cmd: CliCommand): readonly SlashAction[] {
  const out: SlashAction[] = [];
  if (cmd.leaf || !cmd.subcommands?.length) {
    out.push({
      id: cmd.name,
      label: cmd.name,
      summary: cmd.summary,
      kind: "cli",
      argv: [cmd.name],
    });
  }
  if (cmd.subcommands) {
    for (const sub of cmd.subcommands) {
      // Nested like vault key rotate — positionals may be more tokens.
      const pos = sub.positionals?.trim();
      const base = `${cmd.name} ${sub.name}`;
      out.push({
        id: base,
        label: base,
        summary: sub.summary,
        kind: "cli",
        argv: [cmd.name, sub.name],
      });
      // Offer common nested positionals as separate autofill stubs when they
      // look like literal tokens (not <placeholders>).
      if (pos && !pos.includes("<") && !pos.includes("[")) {
        const tokens = pos.split(/\s+/).filter(Boolean);
        out.push({
          id: `${base} ${tokens.join(" ")}`,
          label: `${base} ${tokens.join(" ")}`,
          summary: sub.summary,
          kind: "cli",
          argv: [cmd.name, sub.name, ...tokens],
        });
      }
    }
  }
  return out;
}

let cached: readonly SlashAction[] | undefined;

/**
 * Full slash catalogue (panels + every registry command/subcommand).
 */
export function slashCatalog(): readonly SlashAction[] {
  if (cached) return cached;
  const cli = OKE_COMMANDS.flatMap((c) => expandCommand(c));
  // Prefer panel jumps + high-traffic commands near the top for empty query.
  cached = [...PANEL_JUMPS, ...cli];
  return cached;
}

/**
 * Score + filter catalogue entries for autofill.
 *
 * Matching: prefix on id, then substring, then word-prefix. Case-insensitive.
 *
 * @param query - Text after `/` (no leading slash)
 * @param limit - Max suggestions
 */
export function filterSlashActions(query: string, limit: number = 12): readonly SlashAction[] {
  const q = query.trim().toLowerCase();
  const all = slashCatalog();
  if (q.length === 0) {
    return all.slice(0, limit);
  }

  type Ranked = { readonly action: SlashAction; readonly score: number };
  const ranked: Ranked[] = [];
  for (const action of all) {
    const id = action.id.toLowerCase();
    const summary = action.summary.toLowerCase();
    let score = -1;
    if (id === q) score = 1000;
    else if (id.startsWith(q)) score = 800 - id.length;
    else if (id.includes(` ${q}`) || id.includes(q)) score = 500 - id.indexOf(q);
    else if (summary.includes(q)) score = 200;
    else {
      // Word-prefix: every query token starts a word in id
      const words = id.split(/[\s:/._-]+/);
      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 0 && tokens.every((t) => words.some((w) => w.startsWith(t)))) {
        score = 400;
      }
    }
    if (score >= 0) ranked.push({ action, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
  return ranked.slice(0, limit).map((r) => r.action);
}

/**
 * Longest common prefix among suggestion ids (for Tab autofill).
 *
 * @param ids - Candidate labels
 */
export function commonPrefix(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  let prefix = ids[0]!;
  for (let i = 1; i < ids.length; i++) {
    const s = ids[i]!;
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix.length === 0) break;
  }
  return prefix;
}

/**
 * Parse free-typed slash input into argv after `oke`.
 *
 * @param raw - Text after `/`
 */
export function parseSlashArgv(raw: string): readonly string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}
