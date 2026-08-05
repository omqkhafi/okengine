/**
 * `oke replay --request-id <id>` — re-invoke a past Flow from a WideEvent.
 */

import { resolve } from "node:path";
import { withDryRun } from "../kernel/dry-run.ts";
import type { AnyFlowDef } from "../kernel/flow.ts";
import type { InternalTrigger } from "../kernel/triggers.ts";
import { createRunsRuntime, type RunsRuntime, type WideEvent } from "../runs/index.ts";
import { resolveStartEntry } from "./start.ts";
import { flagValue, hasFlag } from "./args.ts";
import { EXIT_OK, EXIT_USAGE } from "./exit.ts";

/** Options for {@link runReplay}. */
export interface ReplayOptions {
  readonly requestId: string;
  readonly cwd?: string;
  readonly entry?: string;
  /** Force dry-run (stub irreversible effects). */
  readonly dryRun?: boolean;
  /** Force live replay even when the ledger has send/ask. */
  readonly live?: boolean;
  readonly write?: (text: string) => void;
  /** Injected runs runtime (tests). */
  readonly runs?: RunsRuntime;
  /**
   * Load and execute the app (tests).
   *
   * @param entry - Absolute entry path
   * @param event - Wide event to replay
   * @param dryRun - Whether to wrap in dry-run
   */
  readonly executeReplay?: (
    entry: string,
    event: WideEvent,
    dryRun: boolean,
  ) => Promise<{ readonly output: unknown; readonly failure?: unknown }>;
}

/**
 * True when the event's effect ledger includes irreversible kinds.
 *
 * @param event - Wide event
 */
export function eventHasIrreversible(event: WideEvent): boolean {
  return event.effects.some((e) => e.kind === "send" || e.kind === "ask");
}

/**
 * Look up a WideEvent by id across the runs store.
 *
 * @param runs - Open runs runtime
 * @param id - Request / run id
 */
export async function findRunById(runs: RunsRuntime, id: string): Promise<WideEvent | undefined> {
  const all = await runs.all();
  return all.find((e) => e.id === id);
}

/**
 * Resolve an OkeApp export from an entry module.
 *
 * @param mod - Imported module
 */
export function appFromModule(mod: Record<string, unknown>): {
  execute: (
    flow: AnyFlowDef,
    input: unknown,
    trigger: InternalTrigger,
  ) => Promise<{ output: unknown; failure?: unknown }>;
  bindings: readonly { flow: AnyFlowDef }[];
} | null {
  const candidates = [mod.app, mod.default, mod.oke];
  for (const c of candidates) {
    if (
      c &&
      typeof c === "object" &&
      "execute" in c &&
      typeof (c as { execute: unknown }).execute === "function" &&
      "bindings" in c
    ) {
      return c as {
        execute: (
          flow: AnyFlowDef,
          input: unknown,
          trigger: InternalTrigger,
        ) => Promise<{ output: unknown; failure?: unknown }>;
        bindings: readonly { flow: AnyFlowDef }[];
      };
    }
  }
  return null;
}

async function defaultExecuteReplay(
  entry: string,
  event: WideEvent,
  dryRun: boolean,
): Promise<{ readonly output: unknown; readonly failure?: unknown }> {
  const mod = (await import(entry)) as Record<string, unknown>;
  const app = appFromModule(mod);
  if (!app) {
    throw new Error(`oke replay: ${entry} must export \`app\` (oke({…}))`);
  }
  const flow = app.bindings.map((b) => b.flow).find((f) => f.name === event.flow);
  if (!flow) {
    throw new Error(`oke replay: flow "${event.flow}" not found in app bindings`);
  }
  if (event.input === undefined) {
    throw new Error(
      `oke replay: run "${event.id}" has no stored input — re-run after upgrading to a build that persists WideEvent.input`,
    );
  }
  const trigger: InternalTrigger = { kind: "internal" };
  const run = () => app.execute(flow, event.input, trigger);
  if (dryRun) {
    const wrapped = await withDryRun(run);
    return wrapped.result as { output: unknown; failure?: unknown };
  }
  return run();
}

/**
 * Replay a past run locally from the Runs store.
 *
 * @param options - Request id + entry
 */
export async function runReplay(options: ReplayOptions): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();

  try {
    const runs =
      options.runs ??
      createRunsRuntime({
        driver: "files",
        localRoot: resolve(cwd, ".oke/runs"),
      });
    if (!runs.store) await runs.open();

    const event = await findRunById(runs, options.requestId);
    if (!event) {
      console.error(`oke replay: run not found: ${options.requestId}`);
      return 1;
    }
    if (event.input === undefined) {
      console.error(
        `oke replay: run "${options.requestId}" has no stored input (cannot re-invoke)`,
      );
      return 1;
    }

    const irreversible = eventHasIrreversible(event);
    const dryRun = options.live === true ? false : options.dryRun === true || irreversible;
    if (irreversible && !options.live && options.dryRun !== false) {
      write(
        "oke replay: ledger has send/ask — running as dry-run (pass --live to re-execute external effects)\n",
      );
    }

    const execute = options.executeReplay ?? defaultExecuteReplay;
    const entry = options.executeReplay
      ? (options.entry ?? "test://entry")
      : await resolveStartEntry(cwd, options.entry);
    write(`oke replay: ${event.flow} ← ${event.id}${dryRun ? " (dry-run)" : ""}\n`);
    const result = await execute(entry, event, dryRun);
    if (result.failure) {
      write(`oke replay: failed ${JSON.stringify(result.failure)}\n`);
      return 1;
    }
    write(`oke replay: ok ${JSON.stringify(result.output ?? null)}\n`);
    return EXIT_OK;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * CLI entry for `oke replay`.
 *
 * @param args - Args after `replay`
 */
export async function replayCli(args: readonly string[]): Promise<number> {
  if (hasFlag(args, "--help", "-h")) {
    console.log(`oke replay --request-id <id> [--entry|-e src/app.ts] [--dry-run] [--live]

Re-invoke a past Flow locally from a WideEvent in the Runs store.
Defaults to dry-run when the ledger contains send/ask effects.
`);
    return EXIT_OK;
  }

  const requestId = flagValue(args, "--request-id", "-r");
  if (!requestId) {
    console.error("Usage: oke replay --request-id <id>");
    return EXIT_USAGE;
  }

  return runReplay({
    requestId,
    entry: flagValue(args, "--entry", "-e"),
    dryRun: hasFlag(args, "--dry-run"),
    live: hasFlag(args, "--live"),
  });
}
