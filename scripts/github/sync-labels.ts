#!/usr/bin/env bun
/**
 * Apply `.github/labels.yml` to the repository.
 *
 * Adds labels, updates color and description, and renames mapped defaults.
 * Deletes a label that is not in the file only when it is on zero issues
 * and pull requests. `--dry-run` prints the plan and does not mutate.
 *
 *   bun scripts/github/sync-labels.ts
 *   bun scripts/github/sync-labels.ts --dry-run
 */

import { YAML } from "bun";
import { join } from "node:path";

import { ghApi, isRecord } from "./gh.ts";

export interface LabelSpec {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface LiveLabel {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export type LabelAction =
  | { readonly kind: "rename"; readonly from: string; readonly to: string }
  | { readonly kind: "create"; readonly label: LabelSpec }
  | { readonly kind: "update"; readonly label: LabelSpec }
  | { readonly kind: "delete"; readonly name: string; readonly count: number }
  | { readonly kind: "keep"; readonly name: string; readonly count: number | null };

export interface LabelPlanInput {
  readonly desired: readonly LabelSpec[];
  readonly renames: Readonly<Record<string, string>>;
  readonly live: readonly LiveLabel[];
  /** Use counts keyed by current label name. A missing key means unknown. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Plan label changes. A label with an unknown use count is kept.
 *
 * @param input - Desired list, rename map, live labels, and use counts
 */
export function planLabelSync(input: LabelPlanInput): readonly LabelAction[] {
  const desiredByName = new Map(input.desired.map((label) => [label.name, label]));
  const live = new Map(input.live.map((label) => [label.name, label]));
  const actions: LabelAction[] = [];

  for (const [from, to] of Object.entries(input.renames)) {
    if (!live.has(from) || live.has(to) || !desiredByName.has(to)) continue;
    actions.push({ kind: "rename", from, to });
    live.delete(from);
    const desired = desiredByName.get(to);
    if (desired !== undefined) {
      live.set(to, { name: to, color: desired.color, description: desired.description });
    }
  }

  for (const label of input.desired) {
    const current = live.get(label.name);
    if (current === undefined) {
      actions.push({ kind: "create", label });
      continue;
    }
    const colorChanged = normalizeColor(current.color) !== normalizeColor(label.color);
    if (colorChanged || current.description !== label.description) {
      actions.push({ kind: "update", label });
    }
  }

  const desiredNames = new Set(input.desired.map((label) => label.name));
  for (const name of live.keys()) {
    if (desiredNames.has(name)) continue;
    const count = input.counts[name];
    if (count === undefined) {
      actions.push({ kind: "keep", name, count: null });
    } else if (count > 0) {
      actions.push({ kind: "keep", name, count });
    } else {
      actions.push({ kind: "delete", name, count });
    }
  }

  return actions;
}

/** @param action - One planned change */
export function formatLabelAction(action: LabelAction): string {
  switch (action.kind) {
    case "rename":
      return `rename ${action.from} -> ${action.to}`;
    case "create":
      return `create ${action.label.name} (#${normalizeColor(action.label.color)}) ${action.label.description}`;
    case "update":
      return `update ${action.label.name} (#${normalizeColor(action.label.color)}) ${action.label.description}`;
    case "delete":
      return `delete ${action.name} (${action.count} issues or pull requests)`;
    case "keep":
      return action.count === null
        ? `keep ${action.name} (use count unknown)`
        : `keep ${action.name} (${action.count} issues or pull requests)`;
  }
}

/** @param color - Hex color with or without a leading `#` */
export function normalizeColor(color: string): string {
  return color.replace(/^#/, "").toLowerCase();
}

interface LabelFile {
  readonly desired: readonly LabelSpec[];
  readonly renames: Readonly<Record<string, string>>;
}

function parseSpecText(text: string): LabelFile {
  const parsed: unknown = YAML.parse(text);
  if (!isRecord(parsed)) throw new Error("labels.yml must be a mapping");
  const renames: Record<string, string> = {};
  const rawRenames = parsed["renames"];
  if (rawRenames !== undefined) {
    if (!isRecord(rawRenames)) throw new Error("renames must be a mapping");
    for (const [from, to] of Object.entries(rawRenames)) {
      if (typeof to !== "string") throw new Error(`rename target for ${from} must be a string`);
      renames[from] = to;
    }
  }
  const rawLabels = parsed["labels"];
  if (!Array.isArray(rawLabels)) throw new Error("labels.yml needs a labels list");
  const desired: LabelSpec[] = [];
  for (const entry of rawLabels) {
    if (!isRecord(entry)) throw new Error("each label must be a mapping");
    const name = entry["name"];
    const color = entry["color"];
    const description = entry["description"];
    if (typeof name !== "string" || typeof color !== "string" || typeof description !== "string") {
      throw new Error("each label needs name, color, and description");
    }
    desired.push({ name, color, description });
  }
  return { desired, renames };
}

async function listLabels(repo: string): Promise<LiveLabel[]> {
  const raw = await ghApi([
    "--paginate",
    `repos/${repo}/labels`,
    "--jq",
    ".[] | {name,color,description}",
  ]);
  const labels: LiveLabel[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed) || typeof parsed["name"] !== "string") continue;
    labels.push({
      name: parsed["name"],
      color: typeof parsed["color"] === "string" ? parsed["color"] : "",
      description: typeof parsed["description"] === "string" ? parsed["description"] : "",
    });
  }
  return labels;
}

async function useCounts(repo: string, names: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of names) {
    const q = `repo:${repo} label:"${name.replaceAll('"', '\\"')}"`;
    const raw = await ghApi([`search/issues?q=${encodeURIComponent(q)}&per_page=1`]);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["total_count"] !== "number") continue;
    counts[name] = parsed["total_count"];
  }
  return counts;
}

async function applyAction(repo: string, spec: LabelFile, action: LabelAction): Promise<void> {
  if (action.kind === "rename") {
    const desired = spec.desired.find((label) => label.name === action.to);
    if (desired === undefined) return;
    await ghApi(
      [
        "--method",
        "PATCH",
        `repos/${repo}/labels/${encodeURIComponent(action.from)}`,
        "--input",
        "-",
      ],
      {
        input: JSON.stringify({
          new_name: action.to,
          color: normalizeColor(desired.color),
          description: desired.description,
        }),
      },
    );
    return;
  }
  if (action.kind === "create") {
    await ghApi(["--method", "POST", `repos/${repo}/labels`, "--input", "-"], {
      input: JSON.stringify({
        name: action.label.name,
        color: normalizeColor(action.label.color),
        description: action.label.description,
      }),
    });
    return;
  }
  if (action.kind === "update") {
    await ghApi(
      [
        "--method",
        "PATCH",
        `repos/${repo}/labels/${encodeURIComponent(action.label.name)}`,
        "--input",
        "-",
      ],
      {
        input: JSON.stringify({
          color: normalizeColor(action.label.color),
          description: action.label.description,
        }),
      },
    );
    return;
  }
  if (action.kind === "delete") {
    await ghApi(["--method", "DELETE", `repos/${repo}/labels/${encodeURIComponent(action.name)}`]);
  }
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const repo = process.env["GITHUB_REPOSITORY"] ?? "omqkhafi/okengine";
  const spec = parseSpecText(
    await Bun.file(join(import.meta.dir, "../../.github/labels.yml")).text(),
  );
  const live = await listLabels(repo);
  const counts = await useCounts(
    repo,
    live.map((label) => label.name),
  );
  const actions = planLabelSync({ ...spec, live, counts });
  console.log(`label sync (${dryRun ? "dry-run" : "apply"}) for ${repo}`);
  if (actions.length === 0) console.log("no changes");
  for (const action of actions) console.log(formatLabelAction(action));
  if (!dryRun) {
    for (const action of actions) await applyAction(repo, spec, action);
  }
}
