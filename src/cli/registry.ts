/**
 * `oke` command registry — single source of truth for help, flags, and
 * shell completion. Adding a command here is what makes it appear in
 * `oke completion` (no separate hand-maintained script).
 */

/** One CLI flag (long form is canonical; short is convenience only). */
export interface CliFlag {
  /** Canonical long form including leading dashes (e.g. `--docker`). */
  readonly long: string;
  /** Optional short form including leading dash (e.g. `-s`). */
  readonly short?: string;
  /** Whether the flag takes a value. */
  readonly takesValue?: boolean;
  /** Value placeholder for help (e.g. `roles`, `path`). */
  readonly valueName?: string;
  /** One-line summary. */
  readonly summary: string;
}

/** Nested subcommand (e.g. `schema generate`, `gates list`). */
export interface CliSubcommand {
  readonly name: string;
  readonly summary: string;
  readonly flags?: readonly CliFlag[];
  /** Positional hint for help (e.g. `<url>`, `<name>`). */
  readonly positionals?: string;
}

/** Top-level `oke` command. */
export interface CliCommand {
  readonly name: string;
  readonly summary: string;
  readonly flags?: readonly CliFlag[];
  readonly subcommands?: readonly CliSubcommand[];
  /** Positional hint when the command itself takes args. */
  readonly positionals?: string;
  /** When true, `oke <name>` alone is valid (no required subcommand). */
  readonly leaf?: boolean;
}

/** Shared flags reused across commands. */
const MANIFEST: CliFlag = {
  long: "--manifest",
  short: "-m",
  takesValue: true,
  valueName: "path",
  summary: "Manifest path",
};

const CONFIG: CliFlag = {
  long: "--config",
  short: "-c",
  takesValue: true,
  valueName: "path",
  summary: "oke.config.ts path",
};

const OUT: CliFlag = {
  long: "--out",
  short: "-o",
  takesValue: true,
  valueName: "path",
  summary: "Output path",
};

const ENTRY: CliFlag = {
  long: "--entry",
  short: "-e",
  takesValue: true,
  valueName: "path",
  summary: "App entry module",
};

const JSON_FLAG: CliFlag = {
  long: "--json",
  short: "-j",
  summary: "Machine-parseable JSON on stdout (hints on stderr)",
};

const HELP: CliFlag = {
  long: "--help",
  short: "-h",
  summary: "Show help",
};

const VAULT_KEY: CliFlag = {
  long: "--key",
  takesValue: true,
  valueName: "base64|-",
  summary: "Master key (`-` = stdin; else env / interactive prompt)",
};

const VAULT_NEW_KEY: CliFlag = {
  long: "--new-key",
  takesValue: true,
  valueName: "base64|-",
  summary: "New master key for resume (`-` = stdin)",
};

const VAULT_URL: CliFlag = {
  long: "--url",
  takesValue: true,
  valueName: "url",
  summary: "SQL URL (else DATABASE_URL)",
};

/**
 * Canonical `oke` command catalogue.
 *
 * Completion and help read this array — do not duplicate command names
 * elsewhere.
 */
export const OKE_COMMANDS: readonly CliCommand[] = [
  {
    name: "dev",
    summary: "watch · hot reload · Console · client types (Docker Compose)",
    leaf: true,
    flags: [
      {
        long: "--docker",
        short: "-d",
        takesValue: true,
        valueName: "roles",
        summary: "Optional compose role filter (default: all roles)",
      },
      {
        long: "--no-db-push",
        summary: "Disable auto `oke db push` on schema change",
      },
      ENTRY,
      HELP,
    ],
  },
  {
    name: "mode",
    summary: "deprecated — oke dev always uses Docker Compose",
    leaf: true,
    flags: [HELP],
  },
  {
    name: "test",
    summary: "run bun test with PGLite test posture",
    leaf: true,
    flags: [HELP],
  },
  {
    name: "start",
    summary: "production entry (Docker CMD)",
    leaf: true,
    flags: [
      ENTRY,
      {
        long: "--port",
        short: "-p",
        takesValue: true,
        valueName: "port",
        summary: "Listen port",
      },
      HELP,
    ],
  },
  {
    name: "doctor",
    summary: "secrets · ports · stub/domain schema drift",
    leaf: true,
    flags: [
      MANIFEST,
      {
        long: "--diff",
        short: "-d",
        summary: "CI gate: undeclared contract breaks",
      },
      {
        long: "--before",
        short: "-b",
        takesValue: true,
        valueName: "path",
        summary: "Baseline Manifest (--diff)",
      },
      {
        long: "--after",
        short: "-a",
        takesValue: true,
        valueName: "path",
        summary: "Candidate Manifest (--diff)",
      },
      {
        long: "--base",
        short: "-B",
        takesValue: true,
        valueName: "branch",
        summary: "Git base branch for --diff",
      },
      JSON_FLAG,
      HELP,
    ],
  },
  {
    name: "stack",
    summary: "preview images/tags/ports (writes nothing)",
    leaf: true,
    flags: [CONFIG, JSON_FLAG, HELP],
  },
  {
    name: "schema",
    summary: "core + plugin tables → .oke/schema/oke.ts",
    subcommands: [
      {
        name: "generate",
        summary: "Emit .oke/schema/oke.ts",
        flags: [
          {
            long: "--check",
            short: "-c",
            summary: "Fail on drift (CI)",
          },
          MANIFEST,
          OUT,
          HELP,
        ],
      },
    ],
  },
  {
    name: "db",
    summary: "domain schema — push · generate · migrate · seed · studio · search-backfill",
    subcommands: [
      {
        name: "push",
        summary: "Sync schema.ts to the live local DB (dev)",
        flags: [
          {
            long: "--config",
            short: "-c",
            takesValue: true,
            valueName: "path",
            summary: "drizzle.config.ts path",
          },
          {
            long: "--env",
            takesValue: true,
            valueName: "name",
            summary: "Config env (dev|test|prod)",
          },
          HELP,
        ],
      },
      {
        name: "generate",
        summary: "Write versioned SQL under drizzle/",
        flags: [
          {
            long: "--config",
            short: "-c",
            takesValue: true,
            valueName: "path",
            summary: "drizzle.config.ts path",
          },
          {
            long: "--env",
            takesValue: true,
            valueName: "name",
            summary: "Config env (dev|test|prod)",
          },
          HELP,
        ],
      },
      {
        name: "migrate",
        summary: "Apply generated migrations (explicit)",
        flags: [
          {
            long: "--config",
            short: "-c",
            takesValue: true,
            valueName: "path",
            summary: "drizzle.config.ts path",
          },
          {
            long: "--env",
            takesValue: true,
            valueName: "name",
            summary: "Config env (dev|test|prod)",
          },
          HELP,
        ],
      },
      {
        name: "seed",
        summary: "Run defineSeed (essential + env category); never at boot",
        flags: [
          {
            long: "--env",
            takesValue: true,
            valueName: "name",
            summary: "Config env (dev|test|prod)",
          },
          {
            long: "--force",
            summary: "Skip docker/prod confirmation prompt",
          },
          ENTRY,
          HELP,
        ],
      },
      {
        name: "studio",
        summary: "Open drizzle-kit Studio (long-running)",
        flags: [
          {
            long: "--config",
            short: "-c",
            takesValue: true,
            valueName: "path",
            summary: "drizzle.config.ts path",
          },
          {
            long: "--env",
            takesValue: true,
            valueName: "name",
            summary: "Config env (dev|test|prod)",
          },
          HELP,
        ],
      },
      {
        name: "search-backfill",
        summary: "Rebuild hybrid-search stats / embeddings (never auto on push)",
        positionals: "<table>",
        flags: [
          {
            long: "--batch",
            takesValue: true,
            valueName: "n",
            summary: "Rows per page (default 32)",
          },
          {
            long: "--env",
            takesValue: true,
            valueName: "name",
            summary: "Config env (dev|test|prod)",
          },
          HELP,
        ],
      },
    ],
  },
  {
    name: "client",
    summary: "ambient types for a separate frontend repo",
    subcommands: [
      {
        name: "add",
        summary: "Fetch client descriptor and write .d.ts",
        positionals: "<url>",
        flags: [OUT, HELP],
      },
    ],
  },
  {
    name: "vault",
    summary: "secrets — set · list · seal/unseal · rotate · audit · backup",
    subcommands: [
      {
        name: "set",
        summary: "Set a secret",
        positionals: "<NAME> [value]",
        flags: [HELP],
      },
      { name: "list", summary: "List secret names", flags: [HELP] },
      {
        name: "import",
        summary: "Import from a dotenv file",
        positionals: "<file>",
        flags: [HELP],
      },
      {
        name: "key",
        summary: "Key operations",
        positionals: "rotate",
        flags: [HELP],
      },
      {
        name: "init",
        summary: "Create the builtin vault; print the master key once",
        flags: [VAULT_URL, HELP],
      },
      {
        name: "status",
        summary: "Seal state · KEK generation · secret count",
        flags: [VAULT_KEY, VAULT_URL, JSON_FLAG, HELP],
      },
      {
        name: "seal",
        summary: "Drop the master key; reads fail until unsealed",
        flags: [VAULT_URL, HELP],
      },
      {
        name: "unseal",
        summary: "Verify the master key and clear the sealed flag",
        flags: [VAULT_KEY, VAULT_URL, HELP],
      },
      {
        name: "rotate",
        summary: "New version of a secret under a fresh data key",
        positionals: "<path> [value]",
        flags: [VAULT_KEY, VAULT_URL, HELP],
      },
      {
        name: "rotate-master",
        summary: "New master key; re-wrap every data key",
        flags: [VAULT_KEY, VAULT_NEW_KEY, VAULT_URL, HELP],
      },
      {
        name: "audit",
        summary: "Read · verify · purge the tamper-evident chain",
        positionals: "[verify|purge]",
        flags: [
          {
            long: "--limit",
            takesValue: true,
            valueName: "n",
            summary: "Rows to show (default 50)",
          },
          {
            long: "--path",
            takesValue: true,
            valueName: "path",
            summary: "Restrict to one secret path",
          },
          {
            long: "--before",
            takesValue: true,
            valueName: "iso",
            summary: "Purge rows older than this instant",
          },
          VAULT_URL,
          JSON_FLAG,
          HELP,
        ],
      },
      {
        name: "purge-expired",
        summary: "Hard-delete secret rows past expires_at",
        flags: [
          VAULT_KEY,
          VAULT_URL,
          {
            long: "--dry-run",
            summary: "Count expired rows without deleting",
          },
          {
            long: "--before",
            takesValue: true,
            valueName: "iso",
            summary: "Exclusive upper bound (default: now)",
          },
          HELP,
        ],
      },
      {
        name: "backup",
        summary: "Write every live secret as one encrypted bundle",
        positionals: "<file>",
        flags: [VAULT_KEY, VAULT_URL, HELP],
      },
      {
        name: "restore",
        summary: "Replay a bundle as new versions",
        positionals: "<file>",
        flags: [VAULT_KEY, VAULT_URL, HELP],
      },
    ],
  },
  {
    name: "docker",
    summary: "derive compose · clean leftover stacks",
    leaf: true,
    flags: [
      {
        long: "--prod",
        short: "-p",
        summary: "Prod overlays (app /_/ready healthcheck, deploy, limits)",
      },
      OUT,
      CONFIG,
      MANIFEST,
      HELP,
    ],
    subcommands: [
      {
        name: "clean",
        summary: "Remove oke-dev stacks (containers, networks, volumes)",
        flags: [
          {
            long: "--yes",
            short: "-y",
            summary: "Non-interactive confirm",
          },
          {
            long: "--all",
            summary: "Every oke-dev-* stack (required with --yes outside a project)",
          },
          HELP,
        ],
      },
    ],
  },
  {
    name: "images",
    summary: "list configured images · pin tags to digests",
    subcommands: [
      {
        name: "list",
        summary: "List configured images (writes nothing)",
        flags: [CONFIG, JSON_FLAG, HELP],
      },
      {
        name: "pin",
        summary: "Tags → digests in oke.images.lock",
        flags: [CONFIG, OUT, HELP],
      },
    ],
  },
  {
    name: "build",
    summary: "tree-shaken bundle",
    leaf: true,
    flags: [
      {
        long: "--target",
        short: "-t",
        takesValue: true,
        valueName: "bun|node|edge",
        summary: "Bundle target",
      },
      ENTRY,
      {
        long: "--outdir",
        short: "-o",
        takesValue: true,
        valueName: "dir",
        summary: "Output directory",
      },
      HELP,
    ],
  },
  {
    name: "eval",
    summary: "prompt eval sets (CI gate)",
    leaf: true,
    flags: [MANIFEST, HELP],
  },
  {
    name: "ai",
    summary: "configure AI driver + models",
    subcommands: [
      {
        name: "setup",
        summary: "Interactive / flagged AI provider + model setup",
        flags: [
          {
            long: "--provider",
            takesValue: true,
            valueName: "id",
            summary: "openrouter · openai · anthropic · groq · … · lmstudio · custom",
          },
          {
            long: "--chat",
            takesValue: true,
            valueName: "model",
            summary: "Chat model id",
          },
          {
            long: "--vision",
            takesValue: true,
            valueName: "model",
            summary: "Vision model id",
          },
          {
            long: "--embed",
            takesValue: true,
            valueName: "model",
            summary: "Embedding model id",
          },
          {
            long: "--yes",
            short: "-y",
            summary: "Non-interactive (requires --provider)",
          },
          HELP,
        ],
      },
    ],
  },
  {
    name: "branch",
    summary: "fork journaled state",
    leaf: true,
    positionals: "<name>",
    flags: [
      {
        long: "--at",
        short: "-a",
        takesValue: true,
        valueName: "when",
        summary: "Time expression",
      },
      HELP,
    ],
  },
  {
    name: "replay",
    summary: "re-invoke a past Flow from a Runs WideEvent",
    leaf: true,
    flags: [
      {
        long: "--request-id",
        short: "-r",
        takesValue: true,
        valueName: "id",
        summary: "WideEvent / run id to replay",
      },
      ENTRY,
      {
        long: "--dry-run",
        summary: "Stub irreversible effects (send / ask)",
      },
      {
        long: "--live",
        summary: "Allow live re-execution of send / ask effects",
      },
      HELP,
    ],
  },
  {
    name: "privacy",
    summary: "crypto-shred subject data",
    subcommands: [
      {
        name: "erase",
        summary: "Delete per-subject Vault key",
        flags: [
          {
            long: "--subject",
            short: "-s",
            takesValue: true,
            valueName: "id",
            summary: "Subject id (required)",
          },
          HELP,
        ],
      },
    ],
  },
  {
    name: "upgrade",
    summary: "breaking-change codemods + diff",
    leaf: true,
    flags: [
      {
        long: "--apply",
        short: "-a",
        summary: "Write files (default is dry-run)",
      },
      HELP,
    ],
  },
  {
    name: "console",
    summary: "Console helpers — claim-code",
    subcommands: [
      {
        name: "claim-code",
        summary: "Print the local setup claim code from .oke/claim-code",
        flags: [JSON_FLAG, HELP],
      },
    ],
  },
  {
    name: "gates",
    summary: "gate catalogue from Manifest",
    subcommands: [
      {
        name: "list",
        summary: "Print every Module:Action pair",
        flags: [MANIFEST, JSON_FLAG, HELP],
      },
    ],
  },
  {
    name: "completion",
    summary: "print shell completion script",
    leaf: true,
    positionals: "bash|zsh|fish",
    flags: [HELP],
  },
];

/**
 * Format top-level help from the registry.
 *
 * @returns Help text (no trailing exit-code block)
 */
export function formatOkeHelp(): string {
  const lines = [
    "oke — okengine CLI",
    "",
    "  oke              Interactive TUI (TTY). Non-TTY prints this help.",
    "  oke --tui        Force the interactive TUI",
    "  oke --help       This command list",
    "",
    "Commands:",
  ];
  for (const cmd of OKE_COMMANDS) {
    const usage = formatCommandUsage(cmd);
    lines.push(`  ${pad(usage, 34)} ${cmd.summary}`);
    if (cmd.name === "doctor") {
      lines.push(`  ${pad("oke doctor --diff|-d", 34)} CI gate: undeclared contract breaks`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Collect every top-level command name (for completion / tests).
 */
export function commandNames(commands: readonly CliCommand[] = OKE_COMMANDS): readonly string[] {
  return commands.map((c) => c.name);
}

/**
 * Collect flag tokens (long + short) for a command path.
 *
 * @param command - Top-level command
 * @param sub - Optional subcommand name
 */
export function flagTokensFor(command: CliCommand, sub?: string): readonly string[] {
  const flags = sub
    ? (command.subcommands?.find((s) => s.name === sub)?.flags ?? [])
    : (command.flags ?? []);
  const out: string[] = [];
  for (const f of flags) {
    out.push(f.long);
    if (f.short) out.push(f.short);
  }
  return out;
}

function formatCommandUsage(cmd: CliCommand): string {
  // Leaf + subcommands (e.g. `oke docker` derive · `oke docker clean`).
  if (cmd.leaf && cmd.subcommands && cmd.subcommands.length > 0) {
    const flagHint = cmd.flags
      ?.filter((f) => f.long !== "--help")
      .slice(0, 2)
      .map((f) => formatFlagHint(f))
      .join(" ");
    const subs = cmd.subcommands.map((s) => s.name).join("|");
    return `oke ${cmd.name}${flagHint ? ` ${flagHint}` : ""} · ${subs}`;
  }
  if (cmd.subcommands?.length === 1) {
    const sub = cmd.subcommands[0]!;
    const flagHint = sub.flags
      ?.filter((f) => f.long !== "--help")
      .slice(0, 2)
      .map((f) => formatFlagHint(f))
      .join(" ");
    const pos = sub.positionals ? ` ${sub.positionals}` : "";
    return `oke ${cmd.name} ${sub.name}${pos}${flagHint ? ` ${flagHint}` : ""}`;
  }
  if (cmd.subcommands && cmd.subcommands.length > 1) {
    const subs = summarizeSubcommands(cmd.subcommands);
    // Prefer shared JSON flag hint when every list-like sub supports it.
    const jsonHint = cmd.subcommands.some((s) => s.flags?.some((f) => f.long === "--json"))
      ? " [--json|-j]"
      : "";
    return `oke ${cmd.name} ${subs}${jsonHint}`;
  }
  const flagHint = cmd.flags
    ?.filter((f) => f.long !== "--help")
    .slice(0, 2)
    .map((f) => formatFlagHint(f))
    .join(" ");
  const pos = cmd.positionals ? ` ${cmd.positionals}` : "";
  return `oke ${cmd.name}${pos}${flagHint ? ` ${flagHint}` : ""}`;
}

/** Longest `a|b|c` sub list the one-line help layout can carry. */
const MAX_SUBCOMMAND_HINTS = 4;

/**
 * Join subcommand names for the one-line usage, eliding a long tail.
 *
 * Commands with a large surface (`vault`) would otherwise push the summary
 * column off screen; the full list still reaches completion and `--help`.
 *
 * @param subs - Subcommands in registry order
 */
function summarizeSubcommands(subs: readonly CliSubcommand[]): string {
  const shown = subs.slice(0, MAX_SUBCOMMAND_HINTS).map((s) => s.name);
  return subs.length > MAX_SUBCOMMAND_HINTS ? `${shown.join("|")}|…` : shown.join("|");
}

function formatFlagHint(f: CliFlag): string {
  const name = f.short ? `${f.long}|${f.short}` : f.long;
  if (f.takesValue) {
    // Optional value (e.g. --docker [roles]) when valueName is roles-like.
    if (f.long === "--docker") return `[${name} [${f.valueName}]]`;
    return `[${name} ${f.valueName}]`;
  }
  return `[${name}]`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
