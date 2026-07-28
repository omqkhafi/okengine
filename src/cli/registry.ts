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

/**
 * Canonical `oke` command catalogue.
 *
 * Completion and help read this array — do not duplicate command names
 * elsewhere.
 */
export const OKE_COMMANDS: readonly CliCommand[] = [
  {
    name: "dev",
    summary: "watch · hot reload · Console · client types",
    leaf: true,
    flags: [
      {
        long: "--local",
        short: "-l",
        summary: "Laptop drivers for this session",
      },
      {
        long: "--docker",
        short: "-d",
        takesValue: true,
        valueName: "roles",
        summary: "Boot generated compose (optional role list)",
      },
      ENTRY,
      HELP,
    ],
  },
  {
    name: "mode",
    summary: "get/set default oke dev mode (local|docker)",
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
    summary: "secrets · ports · schema drift",
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
    summary: "core + plugin tables → schema/oke.ts",
    subcommands: [
      {
        name: "generate",
        summary: "Emit schema/oke.ts",
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
    summary: "set · list · import · key rotate",
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
    ],
  },
  {
    name: "docker",
    summary: "Dockerfile + compose.<role>.yml",
    leaf: true,
    flags: [
      {
        long: "--prod",
        short: "-p",
        summary: "Prod overlays (healthchecks, limits, replicas)",
      },
      OUT,
      CONFIG,
      MANIFEST,
      HELP,
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
    "Commands:",
  ];
  for (const cmd of OKE_COMMANDS) {
    const usage = formatCommandUsage(cmd);
    lines.push(`  ${pad(usage, 34)} ${cmd.summary}`);
    if (cmd.name === "doctor") {
      lines.push(
        `  ${pad("oke doctor --diff|-d", 34)} CI gate: undeclared contract breaks`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Collect every top-level command name (for completion / tests).
 */
export function commandNames(
  commands: readonly CliCommand[] = OKE_COMMANDS,
): readonly string[] {
  return commands.map((c) => c.name);
}

/**
 * Collect flag tokens (long + short) for a command path.
 *
 * @param command - Top-level command
 * @param sub - Optional subcommand name
 */
export function flagTokensFor(
  command: CliCommand,
  sub?: string,
): readonly string[] {
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
    const subs = cmd.subcommands.map((s) => s.name).join("|");
    // Prefer shared JSON flag hint when every list-like sub supports it.
    const jsonHint = cmd.subcommands.some((s) =>
      s.flags?.some((f) => f.long === "--json"),
    )
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
