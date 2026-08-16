/**
 * `oke vault` — two loops behind one command.
 *
 * The **env loop** (`set` · `list` · `import` · `key rotate`) edits a dotenv
 * file, and is what a solo developer uses before any backend exists.
 *
 * The **builtin loop** (`init` · `status` · `seal` · `unseal` · `rotate` ·
 * `rotate-master` · `audit` · `backup` · `restore` · `purge-expired`) drives
 * okengine's own encrypted-at-rest store over SQL through
 * {@link openBuiltinVaultAdapter}. Every invocation is a fresh process, so
 * the master key must be supplied per command via `--key -` (stdin), an
 * interactive prompt, `--key <base64>`, or `OKE_VAULT_MASTER_KEY`.
 *
 * Never pass master keys as CLI arguments in shared environments — they land
 * in shell history. Prefer `--key -` or the interactive prompt.
 *
 * No cleartext secret value is ever printed. `init` and `rotate-master`
 * print a master key exactly once, because that is the only moment it
 * exists outside the operator's hands.
 */

import { resolve } from "node:path";
import type { SqlConnection } from "../drivers/types.ts";
import { openBuiltinVaultAdapter, VAULT_MASTER_KEY_ENV } from "../drivers/vault-builtin.ts";
import { parseDotenv, formatDotenv } from "../drivers/vault-dotenv-parse.ts";
import type { BuiltinVaultAdapter } from "../elements/vault/builtin-adapter.ts";
import { promptHidden, readStdinSecure } from "./vault-secure-input.ts";

/** Env var for the *new* master key when resuming an interrupted `rotate-master`. */
const VAULT_NEW_MASTER_KEY_ENV = "OKE_VAULT_NEW_MASTER_KEY";

/** In-memory / file-backed vault bag for CLI (dotenv-shaped). */
export interface VaultCliStore {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  names(): readonly string[];
  save?(): Promise<void>;
}

/** Options shared by vault subcommands. */
export interface VaultCmdOptions {
  readonly cwd?: string;
  readonly envFile?: string;
  readonly store?: VaultCliStore;
  readonly write?: (text: string) => void;
  readonly readLine?: (prompt: string) => Promise<string>;
  /**
   * Hidden master-key prompt (TTY). Injected by tests; defaults to
   * {@link promptHidden}.
   */
  readonly readSecret?: (prompt: string) => Promise<string>;
  /**
   * Full stdin read for `--key -` / `--new-key -`. Injected by tests;
   * defaults to {@link readStdinSecure}.
   */
  readonly readStdin?: () => Promise<string>;
  /**
   * Environment for master-key and SQL-URL resolution. Defaults to
   * `process.env`.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Override stdin TTY detection (tests). Default: `process.stdin.isTTY`.
   * Non-interactive runs must not block on a hidden master-key prompt.
   */
  readonly stdinIsTTY?: boolean;
  /**
   * Pre-opened SQL connection for the builtin loop. Injected by tests so a
   * sequence of subcommands shares one in-memory database; the CLI never
   * closes a connection it did not open.
   */
  readonly sql?: SqlConnection;
}

/**
 * Open a dotenv-backed store (default `.env.local`).
 *
 * @param path - Env file path
 */
export async function openEnvStore(path: string): Promise<VaultCliStore> {
  const map = new Map<string, string>();
  const file = Bun.file(path);
  if (await file.exists()) {
    for (const [k, v] of parseDotenv(await file.text())) {
      map.set(k, v);
    }
  }
  return {
    get: (n) => map.get(n),
    set: (n, v) => {
      map.set(n, v);
    },
    names: () => [...map.keys()].sort(),
    async save() {
      await Bun.write(path, formatDotenv(map));
    },
  };
}

/** Subcommands served by the SQL-backed builtin Vault rather than dotenv. */
const BUILTIN_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "init",
  "status",
  "seal",
  "unseal",
  "rotate",
  "rotate-master",
  "audit",
  "backup",
  "restore",
  "purge-expired",
]);

/**
 * Run a vault subcommand.
 *
 * @param args - Args after `vault`
 * @param options - Store / connection / env injection
 */
export async function vaultCli(
  args: readonly string[],
  options: VaultCmdOptions = {},
): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const [sub, ...rest] = args;
  if (!sub || sub === "--help" || sub === "-h") {
    write(VAULT_HELP);
    return sub ? 0 : 1;
  }

  if (BUILTIN_SUBCOMMANDS.has(sub)) {
    return runBuiltinVault(sub, rest, options, write);
  }

  const cwd = options.cwd ?? process.cwd();
  const envFile = resolve(cwd, options.envFile ?? ".env.local");
  const store = options.store ?? (await openEnvStore(envFile));

  if (sub === "set") {
    const name = rest[0];
    if (!name) {
      console.error("Usage: oke vault set <NAME> [value]");
      return 1;
    }
    let value = rest[1];
    if (value === undefined) {
      const read =
        options.readLine ??
        (async () => {
          write(`Enter value for ${name}: `);
          const chunks: Buffer[] = [];
          for await (const chunk of Bun.stdin.stream()) {
            chunks.push(Buffer.from(chunk));
            if (Buffer.concat(chunks).includes(0x0a)) break;
          }
          return Buffer.concat(chunks).toString("utf8").trim();
        });
      value = await read(`Enter value for ${name}: `);
    }
    store.set(name, value);
    await store.save?.();
    write(`oke vault: set ${name}\n`);
    return 0;
  }

  if (sub === "list") {
    const names = store.names();
    if (names.length === 0) {
      write("oke vault: (empty)\n");
      return 0;
    }
    for (const n of names) write(`${n}\n`);
    return 0;
  }

  if (sub === "import") {
    const file = rest[0];
    if (!file) {
      console.error("Usage: oke vault import <file>");
      return 1;
    }
    const imported = await openEnvStore(resolve(cwd, file));
    for (const n of imported.names()) {
      const v = imported.get(n);
      if (v !== undefined) store.set(n, v);
    }
    await store.save?.();
    write(`oke vault: imported ${imported.names().length} key(s) from ${file}\n`);
    return 0;
  }

  if (sub === "key" && rest[0] === "rotate") {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    const key = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    store.set("OKE_VAULT_KEY", key);
    await store.save?.();
    write("oke vault: rotated OKE_VAULT_KEY\n");
    return 0;
  }

  console.error(`Unknown vault command: ${sub}`);
  return 1;
}

/** `oke vault --help` body — both loops, env first. */
const VAULT_HELP = `oke vault set <NAME> [value]
oke vault list
oke vault import <file>
oke vault key rotate

Builtin vault (encrypted at rest, SQL-backed):
oke vault init
oke vault status [--json]
oke vault seal
oke vault unseal [--key <base64|-]
oke vault rotate <path> [value]
oke vault rotate-master [--key <base64|-] [--new-key <base64|-]
oke vault audit [--limit <n>] [--path <p>] [--json]
oke vault audit verify
oke vault audit purge --before <iso>
oke vault purge-expired [--dry-run] [--before <iso>]
oke vault backup <file>
oke vault restore <file>

Master key resolution (in order): --key - (stdin), --key <base64>,
${VAULT_MASTER_KEY_ENV}, then an interactive hidden prompt.
Never pass master keys as CLI arguments in shared environments — they land
in shell history. Prefer --key - or the prompt.
--url overrides the SQL URL (DATABASE_URL / OKE_STORE_SQL_URL).
Resume an interrupted rotate-master with --new-key - / --new-key <base64>
(or ${VAULT_NEW_MASTER_KEY_ENV}).
`;

/** Flags understood by the builtin-vault subcommands. */
interface VaultFlags {
  /** Non-flag arguments in order. */
  readonly positionals: readonly string[];
  /** Base64 master key (`--key`) — current / old key for unseal. Use `-` for stdin. */
  readonly key?: string;
  /** Base64 new master key (`--new-key`) — resume interrupted rotate-master. Use `-` for stdin. */
  readonly newKey?: string;
  /** SQL URL override (`--url`). */
  readonly url?: string;
  /** Path filter for `audit` (`--path`). */
  readonly path?: string;
  /** Exclusive upper bound for `audit purge` / `purge-expired` (`--before`). */
  readonly before?: string;
  /** Row cap for `audit` (`--limit`). */
  readonly limit?: number;
  /** Count without deleting (`purge-expired --dry-run`). */
  readonly dryRun: boolean;
  /** Machine-parseable output (`--json` / `-j`). */
  readonly json: boolean;
}

/** Flags that consume the next argument (or a `--flag=value` suffix). */
const VALUE_FLAGS = ["--key", "--new-key", "--url", "--path", "--before", "--limit"] as const;

/**
 * Parse builtin-vault flags, leaving everything else as a positional.
 *
 * Only the builtin loop is parsed this way: `oke vault set` takes arbitrary
 * values that may legitimately begin with a dash.
 *
 * @param args - Args after the subcommand
 */
function parseVaultFlags(args: readonly string[]): VaultFlags {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  let json = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--json" || arg === "-j") {
      json = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    const inline = VALUE_FLAGS.find((f) => arg.startsWith(`${f}=`));
    if (inline) {
      values.set(inline, arg.slice(inline.length + 1));
      continue;
    }
    const flag = VALUE_FLAGS.find((f) => f === arg);
    if (flag) {
      const next = args[i + 1];
      if (next !== undefined) {
        values.set(flag, next);
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }

  const limit = values.get("--limit");
  const parsedLimit = limit === undefined ? Number.NaN : Number.parseInt(limit, 10);
  return {
    positionals,
    json,
    dryRun,
    ...(values.has("--key") ? { key: values.get("--key")! } : {}),
    ...(values.has("--new-key") ? { newKey: values.get("--new-key")! } : {}),
    ...(values.has("--url") ? { url: values.get("--url")! } : {}),
    ...(values.has("--path") ? { path: values.get("--path")! } : {}),
    ...(values.has("--before") ? { before: values.get("--before")! } : {}),
    ...(Number.isFinite(parsedLimit) && parsedLimit > 0 ? { limit: parsedLimit } : {}),
  };
}

/**
 * Open the builtin adapter for one subcommand and close what we opened.
 *
 * @param options - CLI options (env / injected connection)
 * @param flags - Parsed flags
 * @param masterKey - Key to unseal with; `""` leaves the vault sealed
 * @param run - Body receiving the adapter
 */
async function withVault<T>(
  options: VaultCmdOptions,
  flags: VaultFlags,
  masterKey: string,
  run: (adapter: BuiltinVaultAdapter) => Promise<T>,
): Promise<T> {
  const opened = await openBuiltinVaultAdapter({
    env: options.env ?? process.env,
    masterKey,
    ...(flags.url === undefined ? {} : { url: flags.url }),
    ...(options.sql === undefined ? {} : { connection: options.sql }),
  });
  try {
    return await run(opened.adapter);
  } finally {
    await opened.close();
  }
}

/**
 * Resolve the master key for a subcommand that must read or write secrets.
 *
 * Order: `--key -` (stdin) → `--key <value>` → env → interactive prompt
 * when `required` is true.
 *
 * @param flags - Parsed flags
 * @param options - CLI options (env / IO injection)
 * @param required - When true, prompt if nothing else supplies a key
 */
async function resolveMasterKey(
  flags: VaultFlags,
  options: VaultCmdOptions,
  required = false,
): Promise<string | null> {
  if (flags.key === "-") {
    const fromStdin = await (options.readStdin ?? (() => readStdinSecure()))();
    return fromStdin.trim().length > 0 ? fromStdin.trim() : null;
  }
  if (flags.key !== undefined && flags.key.trim().length > 0) {
    return flags.key.trim();
  }
  const env = options.env ?? process.env;
  const fromEnv = env[VAULT_MASTER_KEY_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  if (!required) return null;
  if (options.readSecret) {
    const prompted = (await options.readSecret("Enter current master key: ")).trim();
    return prompted.length > 0 ? prompted : null;
  }
  // Never block a non-interactive pipe waiting for a hidden prompt.
  if (!(options.stdinIsTTY ?? Boolean(process.stdin.isTTY))) return null;
  const prompted = (
    await promptHidden("Enter current master key: ", { write: options.write })
  ).trim();
  return prompted.length > 0 ? prompted : null;
}

/**
 * Resolve the *new* master key when resuming `rotate-master`.
 *
 * @param flags - Parsed flags
 * @param options - CLI options
 * @param required - When true, prompt if nothing else supplies a key
 */
async function resolveNewMasterKey(
  flags: VaultFlags,
  options: VaultCmdOptions,
  required = false,
): Promise<string | undefined> {
  if (flags.newKey === "-") {
    const fromStdin = await (options.readStdin ?? (() => readStdinSecure()))();
    const trimmed = fromStdin.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (flags.newKey !== undefined && flags.newKey.trim().length > 0) {
    return flags.newKey.trim();
  }
  const env = options.env ?? process.env;
  const fromEnv = env[VAULT_NEW_MASTER_KEY_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  if (!required) return undefined;
  if (options.readSecret) {
    const prompted = (await options.readSecret("Enter new master key: ")).trim();
    return prompted.length > 0 ? prompted : undefined;
  }
  if (!(options.stdinIsTTY ?? Boolean(process.stdin.isTTY))) return undefined;
  const prompted = (await promptHidden("Enter new master key: ", { write: options.write })).trim();
  return prompted.length > 0 ? prompted : undefined;
}

/**
 * Run one builtin-vault subcommand.
 *
 * @param sub - Subcommand name
 * @param rest - Args after the subcommand
 * @param options - CLI options
 * @param write - stdout sink
 */
async function runBuiltinVault(
  sub: string,
  rest: readonly string[],
  options: VaultCmdOptions,
  write: (text: string) => void,
): Promise<number> {
  const flags = parseVaultFlags(rest);
  const cwd = options.cwd ?? process.cwd();
  try {
    switch (sub) {
      case "init":
        return await runVaultInit(options, flags, write);
      case "status":
        return await runVaultStatus(options, flags, write);
      case "seal":
        await withVault(options, flags, "", (a) => a.seal());
        write("oke vault: sealed\n");
        return 0;
      case "unseal":
        return await runVaultUnseal(options, flags, write);
      case "rotate":
        return await runVaultRotate(options, flags, write);
      case "rotate-master":
        return await runVaultRotateMaster(options, flags, write);
      case "audit":
        return await runVaultAudit(options, flags, write);
      case "backup":
        return await runVaultBackup(options, flags, cwd, write);
      case "restore":
        return await runVaultRestore(options, flags, cwd, write);
      case "purge-expired":
        return await runVaultPurgeExpired(options, flags, write);
      default:
        console.error(`Unknown vault command: ${sub}`);
        return 1;
    }
  } catch (error) {
    // VaultError messages are secret-free by construction.
    console.error(`oke vault: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * `oke vault init` — create backend state and print the master key once.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultInit(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  // Unsealing is impossible before the master record exists.
  const result = await withVault(options, flags, "", (a) => a.initialize());
  write(`oke vault: initialized (kek v${result.kekVersion})\n`);
  write("\nMaster key — shown once, store it out of band:\n");
  write(`  ${result.masterKey}\n`);
  write(
    `\nLater commands: pipe it with --key - , enter it at the prompt, or set ${VAULT_MASTER_KEY_ENV}.\n`,
  );
  write("Never pass master keys as CLI arguments in shared environments.\n");
  return 0;
}

/**
 * `oke vault status` — seal state, KEK generation, secret count, rewrap.
 *
 * `sealed` is the state of *this* invocation: the vault is unsealed only
 * when a usable master key was supplied.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultStatus(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  // Optional key: do not prompt when absent (status works sealed).
  const status = await withVault(
    options,
    flags,
    (await resolveMasterKey(flags, options)) ?? "",
    (a) => a.status(),
  );
  if (flags.json) {
    write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }
  write("oke vault status\n");
  write(field("initialized", status.initialized ? "yes" : "no"));
  write(field("sealed", status.sealed ? "yes" : "no"));
  write(field("master key", status.masterKeyPresent ? "present" : "absent"));
  write(field("kek version", String(status.kekVersion)));
  write(field("secrets", String(status.secretCount)));
  write(field("seal count", String(status.sealCount)));
  if (status.lastUnsealedAt) write(field("last unsealed", status.lastUnsealedAt.toISOString()));
  if (status.lastSealedAt) write(field("last sealed", status.lastSealedAt.toISOString()));
  if (status.rewrapTargetKekVersion !== undefined) {
    write(field("rewrap target", `kek v${status.rewrapTargetKekVersion}`));
  }
  if (!status.initialized) write("\nRun `oke vault init` to create the vault.\n");
  return 0;
}

/**
 * `oke vault unseal` — verify the master key and clear the sealed flag.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultUnseal(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  const key = await resolveMasterKey(flags, options, true);
  if (key === null) {
    console.error(
      `oke vault: pass --key - (stdin), --key <base64>, set ${VAULT_MASTER_KEY_ENV}, or enter at the prompt`,
    );
    return 1;
  }
  // Opening with a key unseals and records the audit row; a wrong key throws.
  const status = await withVault(options, flags, key, (a) => a.status());
  if (status.sealed) {
    console.error("oke vault: unseal failed — vault is still sealed");
    return 1;
  }
  write(`oke vault: unsealed (kek v${status.kekVersion}, ${status.secretCount} secret(s))\n`);
  return 0;
}

/**
 * `oke vault rotate <path> [value]` — write a new version under a fresh DEK.
 *
 * With no value the current cleartext is re-encrypted, which rotates the
 * data key without changing what readers see.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultRotate(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  const path = flags.positionals[0];
  if (!path) {
    console.error("Usage: oke vault rotate <path> [value]");
    return 1;
  }
  const key = await resolveMasterKey(flags, options, true);
  if (key === null) {
    console.error(
      `oke vault: pass --key - (stdin), --key <base64>, set ${VAULT_MASTER_KEY_ENV}, or enter at the prompt`,
    );
    return 1;
  }

  const rotated = await withVault(options, flags, key, async (adapter) => {
    const current = await adapter.get(path);
    if (!current) return null;
    return adapter.rotate(path, flags.positionals[1] ?? current.value);
  });
  if (!rotated) {
    console.error(`oke vault: no such secret: ${path}`);
    return 1;
  }
  write(`oke vault: rotated ${rotated.path} → v${rotated.version} (fresh data key)\n`);
  return 0;
}

/**
 * `oke vault rotate-master` — new KEK generation, re-wrapping every DEK.
 *
 * Runs the rewrap to completion so the command leaves no half-migrated
 * state behind: an interrupted rotation would keep two master keys live.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultRotateMaster(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  const key = await resolveMasterKey(flags, options, true);
  if (key === null) {
    console.error(
      `oke vault: pass --key - (stdin), --key <base64>, set ${VAULT_MASTER_KEY_ENV}, or enter at the prompt`,
    );
    return 1;
  }

  // Prompt for --new-key only when resuming an interrupted rotation needs it;
  // a fresh rotateMaster() generates the new key itself.
  const newKey = await resolveNewMasterKey(flags, options, false);

  const outcome = await withVault(options, flags, key, async (adapter) => {
    const status = await adapter.status();
    const resumeNeedsKey = status.rewrapTargetKekVersion !== undefined;
    const resumeKey =
      resumeNeedsKey && newKey === undefined
        ? await resolveNewMasterKey(flags, options, true)
        : newKey;
    let progress = resumeNeedsKey
      ? await adapter.continueRotateMaster(resumeKey)
      : await adapter.rotateMaster();
    const masterKey = progress.masterKey;
    let batches = 1;
    while (progress.remaining > 0) {
      progress = await adapter.continueRotateMaster(resumeKey);
      batches += 1;
    }
    return { kekVersion: progress.kekVersion, batches, masterKey };
  });

  write(`oke vault: master rotated → kek v${outcome.kekVersion} (${outcome.batches} batch(es))\n`);
  if (outcome.masterKey !== undefined) {
    write("\nNew master key — shown once, store it out of band:\n");
    write(`  ${outcome.masterKey}\n`);
    write(`\nThe previous ${VAULT_MASTER_KEY_ENV} no longer opens this vault.\n`);
  }
  return 0;
}

/**
 * `oke vault audit [verify|purge]` — read, verify, or trim the audit chain.
 *
 * Audit rows describe operations, never values, so none of these need an
 * unsealed vault.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultAudit(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  const action = flags.positionals[0];

  if (action === "verify") {
    const result = await withVault(options, flags, "", (a) => a.verifyAudit());
    if (flags.json) {
      write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    if (result.ok) {
      write("oke vault: audit chain intact\n");
      return 0;
    }
    console.error(`oke vault: audit chain broken at row ${result.brokenAt}`);
    return 1;
  }

  if (action === "purge") {
    if (flags.before === undefined) {
      console.error("Usage: oke vault audit purge --before <iso>");
      return 1;
    }
    const before = new Date(flags.before);
    if (Number.isNaN(before.getTime())) {
      console.error(`oke vault: --before is not a date: ${flags.before}`);
      return 1;
    }
    const removed = await withVault(options, flags, "", (a) => a.purgeAuditBefore(before));
    write(`oke vault: purged ${removed} audit row(s) before ${before.toISOString()}\n`);
    return 0;
  }

  if (action !== undefined) {
    console.error(`Unknown vault audit command: ${action}`);
    return 1;
  }

  const rows = await withVault(options, flags, "", (a) =>
    a.listAudit({
      limit: flags.limit ?? 50,
      ...(flags.path === undefined ? {} : { path: flags.path }),
    }),
  );
  if (flags.json) {
    write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  if (rows.length === 0) {
    write("oke vault: (no audit rows)\n");
    return 0;
  }
  for (const row of rows) {
    const actor = row.actorId === null ? row.actorType : `${row.actorType}:${row.actorId}`;
    write(
      `${row.createdAt.toISOString()}  ${padRight(row.action, 10)} ${
        row.success ? "ok  " : "FAIL"
      }  ${padRight(actor, 12)} ${row.path ?? "-"}\n`,
    );
  }
  return 0;
}

/**
 * `oke vault backup <file>` — every live secret in one encrypted bundle.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param cwd - Project root for relative paths
 * @param write - stdout sink
 */
async function runVaultBackup(
  options: VaultCmdOptions,
  flags: VaultFlags,
  cwd: string,
  write: (text: string) => void,
): Promise<number> {
  const file = flags.positionals[0];
  if (!file) {
    console.error("Usage: oke vault backup <file>");
    return 1;
  }
  const key = await resolveMasterKey(flags, options, true);
  if (key === null) {
    console.error(
      `oke vault: pass --key - (stdin), --key <base64>, set ${VAULT_MASTER_KEY_ENV}, or enter at the prompt`,
    );
    return 1;
  }
  const blob = await withVault(options, flags, key, (a) => a.exportBackup());
  const { writeBackupFileAtomic } = await import("../elements/vault/builtin-adapter.ts");
  await writeBackupFileAtomic(resolve(cwd, file), blob);
  write(`oke vault: wrote ${blob.byteLength} encrypted byte(s) to ${file}\n`);
  return 0;
}

/**
 * `oke vault restore <file>` — replay a bundle through the normal write path.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param cwd - Project root for relative paths
 * @param write - stdout sink
 */
async function runVaultRestore(
  options: VaultCmdOptions,
  flags: VaultFlags,
  cwd: string,
  write: (text: string) => void,
): Promise<number> {
  const file = flags.positionals[0];
  if (!file) {
    console.error("Usage: oke vault restore <file>");
    return 1;
  }
  const key = await resolveMasterKey(flags, options, true);
  if (key === null) {
    console.error(
      `oke vault: pass --key - (stdin), --key <base64>, set ${VAULT_MASTER_KEY_ENV}, or enter at the prompt`,
    );
    return 1;
  }
  const source = Bun.file(resolve(cwd, file));
  if (!(await source.exists())) {
    console.error(`oke vault: no such file: ${file}`);
    return 1;
  }
  const blob = new Uint8Array(await source.arrayBuffer());
  const restored = await withVault(options, flags, key, async (adapter) => {
    await adapter.importBackup(blob);
    return (await adapter.list()).length;
  });
  write(`oke vault: restored ${file} (${restored} live secret(s))\n`);
  return 0;
}

/**
 * `oke vault purge-expired` — hard-delete secret rows past `expires_at`.
 *
 * @param options - CLI options
 * @param flags - Parsed flags
 * @param write - stdout sink
 */
async function runVaultPurgeExpired(
  options: VaultCmdOptions,
  flags: VaultFlags,
  write: (text: string) => void,
): Promise<number> {
  const key = await resolveMasterKey(flags, options, true);
  if (key === null) {
    console.error(
      `oke vault: pass --key - (stdin), --key <base64>, set ${VAULT_MASTER_KEY_ENV}, or enter at the prompt`,
    );
    return 1;
  }
  let before = new Date();
  if (flags.before !== undefined) {
    before = new Date(flags.before);
    if (Number.isNaN(before.getTime())) {
      console.error(`oke vault: --before is not a date: ${flags.before}`);
      return 1;
    }
  }
  const result = await withVault(options, flags, key, (a) =>
    a.purgeExpired({ before, dryRun: flags.dryRun }),
  );
  if (flags.dryRun) {
    write(
      `oke vault: would purge ${result.count} expired secret row(s) before ${before.toISOString()}\n`,
    );
    return 0;
  }
  write(`oke vault: purged ${result.count} expired secret row(s) before ${before.toISOString()}\n`);
  return 0;
}

/**
 * Format one `label  value` status line.
 *
 * @param label - Left column
 * @param value - Right column
 */
function field(label: string, value: string): string {
  return `  ${padRight(label, 14)} ${value}\n`;
}

/**
 * Pad `text` to `width` with spaces.
 *
 * @param text - Source text
 * @param width - Minimum width
 */
function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}
