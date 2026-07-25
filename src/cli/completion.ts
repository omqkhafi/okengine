/**
 * `oke completion bash|zsh|fish` — scripts generated from {@link OKE_COMMANDS}.
 */

import { EXIT_OK, EXIT_USAGE } from "./exit.ts";
import {
  OKE_COMMANDS,
  commandNames,
  type CliCommand,
  type CliFlag,
} from "./registry.ts";

/** Supported completion shells. */
export const COMPLETION_SHELLS = ["bash", "zsh", "fish"] as const;

/** A supported completion shell. */
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

/** Literal `${` for embedding in shell scripts. */
const D = "${";

/**
 * Generate a completion script from a command registry.
 *
 * @param shell - Target shell
 * @param commands - Registry (defaults to {@link OKE_COMMANDS})
 */
export function generateCompletion(
  shell: CompletionShell,
  commands: readonly CliCommand[] = OKE_COMMANDS,
): string {
  switch (shell) {
    case "bash":
      return bashScript(commands);
    case "zsh":
      return zshScript(commands);
    case "fish":
      return fishScript(commands);
    default: {
      const _: never = shell;
      return _;
    }
  }
}

/**
 * CLI entry for `oke completion <shell>`.
 *
 * @param args - Args after `completion`
 */
export function completionCli(args: readonly string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`oke completion bash|zsh|fish

Print a shell completion script generated from the oke command registry.
Install:
  eval "$(oke completion bash)"
  eval "$(oke completion zsh)"
  oke completion fish | source
`);
    return EXIT_OK;
  }

  const shell = args[0];
  if (!shell || !isCompletionShell(shell)) {
    console.error(
      "oke completion: require bash, zsh, or fish — e.g. oke completion zsh",
    );
    return EXIT_USAGE;
  }

  process.stdout.write(generateCompletion(shell));
  return EXIT_OK;
}

/**
 * Type guard for {@link CompletionShell}.
 *
 * @param value - Candidate
 */
export function isCompletionShell(value: string): value is CompletionShell {
  return (COMPLETION_SHELLS as readonly string[]).includes(value);
}

function bashScript(commands: readonly CliCommand[]): string {
  const names = commandNames(commands).join(" ");
  const caseArms = commands
    .map((cmd) => {
      const subs = (cmd.subcommands ?? []).map((s) => s.name);
      const flags = flagWords(cmd.flags);
      if (subs.length === 0) {
        return `    ${cmd.name})
      COMPREPLY=($(compgen -W "${flags}" -- "$cur"))
      ;;`;
      }
      const subFlags = subs
        .map((sub) => {
          const subCmd = cmd.subcommands!.find((s) => s.name === sub)!;
          const fw = flagWords(subCmd.flags);
          return `      ${sub})
        COMPREPLY=($(compgen -W "${fw}" -- "$cur"))
        ;;`;
        })
        .join("\n");
      return `    ${cmd.name})
      if (( cword == cmd_idx + 1 )); then
        COMPREPLY=($(compgen -W "${subs.join(" ")}" -- "$cur"))
      else
        sub="${D}words[cmd_idx+1]:-}"
        case "$sub" in
${subFlags}
          *)
            COMPREPLY=($(compgen -W "${flags}" -- "$cur"))
            ;;
        esac
      fi
      ;;`;
    })
    .join("\n");

  return `# Bash completion for oke — generated from the command registry
# Install: eval "$(oke completion bash)"

_oke() {
  local cur prev words cword cmd_idx cmd sub
  words=(${D}COMP_WORDS[@]})
  cword=$COMP_CWORD
  cur="${D}words[cword]:-}"
  prev="${D}words[cword-1]:-}"

  cmd_idx=1
  while (( cmd_idx < cword )); do
    if [[ "${D}words[cmd_idx]}" == -* ]]; then
      (( cmd_idx++ ))
    else
      break
    fi
  done
  cmd="${D}words[cmd_idx]:-}"

  if (( cword == cmd_idx )); then
    COMPREPLY=($(compgen -W "${names}" -- "$cur"))
    return
  fi

  case "$cmd" in
    completion)
      COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))
      ;;
${caseArms}
    *)
      COMPREPLY=()
      ;;
  esac
}

complete -F _oke oke 2>/dev/null || complete -o bashdefault -o default -F _oke oke
`;
}

function zshScript(commands: readonly CliCommand[]): string {
  const names = commandNames(commands).join(" ");
  const caseArms = commands
    .map((cmd) => {
      const subs = (cmd.subcommands ?? []).map((s) => s.name);
      if (subs.length === 0) {
        const flags = zshFlagSpecs(cmd.flags);
        return `        ${cmd.name})
          _arguments ${flags}
          ;;`;
      }
      return `        ${cmd.name})
          _values "subcommand" ${subs.map((s) => `"${s}"`).join(" ")}
          ;;`;
    })
    .join("\n");

  return `# Zsh completion for oke — generated from the command registry
# Install: eval "$(oke completion zsh)"

_oke() {
  local cur context state line cmd cmd_idx
  _arguments -C -s -S \\
    '-h[show help]' \\
    '--help[show help]' \\
    '1:command:(${names})' \\
    '*::args:->args'

  case $state in
    args)
      cmd_idx=1
      while (( cmd_idx < CURRENT )); do
        if [[ "${D}words[cmd_idx]}" == -* ]]; then
          (( cmd_idx++ ))
        else
          cmd="${D}words[cmd_idx]}"
          break
        fi
      done
      case "$cmd" in
        completion)
          _values "shell" "bash" "zsh" "fish"
          ;;
${caseArms}
      esac
      ;;
  esac
}

_oke
`;
}

function fishScript(commands: readonly CliCommand[]): string {
  const names = commandNames(commands).join(" ");
  const rebuilt: string[] = [
    `# Fish completion for oke — generated from the command registry`,
    `# Install: oke completion fish | source`,
    "",
  ];
  for (const cmd of commands) {
    rebuilt.push(
      `complete -c oke -f -n "not __fish_seen_subcommand_from ${names}" -a "${cmd.name}" -d ${fishQuote(cmd.summary)}`,
    );
  }
  rebuilt.push(
    `complete -c oke -f -n "__fish_seen_subcommand_from completion" -a "bash zsh fish"`,
  );
  for (const cmd of commands) {
    const subs = cmd.subcommands ?? [];
    if (subs.length === 0) {
      for (const f of cmd.flags ?? []) {
        rebuilt.push(fishFlagLine(cmd.name, undefined, f));
      }
      continue;
    }
    const subNames = subs.map((s) => s.name).join(" ");
    for (const sub of subs) {
      rebuilt.push(
        `complete -c oke -f -n "__fish_seen_subcommand_from ${cmd.name}; and not __fish_seen_subcommand_from ${subNames}" -a "${sub.name}" -d ${fishQuote(sub.summary)}`,
      );
      for (const f of sub.flags ?? []) {
        rebuilt.push(fishFlagLine(cmd.name, sub.name, f));
      }
    }
  }

  return `${rebuilt.join("\n")}\n`;
}

function fishFlagLine(
  command: string,
  sub: string | undefined,
  flag: CliFlag,
): string {
  const seen = sub
    ? `__fish_seen_subcommand_from ${command}; and __fish_seen_subcommand_from ${sub}`
    : `__fish_seen_subcommand_from ${command}`;
  const short = flag.short ? ` -s ${flag.short.replace(/^-/, "")}` : "";
  const long = ` -l ${flag.long.replace(/^--/, "")}`;
  const val = flag.takesValue ? " -r" : " -f";
  return `complete -c oke${val} -n "${seen}"${long}${short} -d ${fishQuote(flag.summary)}`;
}

function flagWords(flags: readonly CliFlag[] | undefined): string {
  if (!flags?.length) return "";
  const tokens: string[] = [];
  for (const f of flags) {
    tokens.push(f.long);
    if (f.short) tokens.push(f.short);
  }
  return tokens.join(" ");
}

function zshFlagSpecs(flags: readonly CliFlag[] | undefined): string {
  if (!flags?.length) return '""';
  return flags
    .map((f) => {
      const desc = f.summary.replace(/'/g, "");
      if (f.short && f.takesValue) {
        return `'${f.short}+[${desc}]:${f.valueName ?? "value"}:' '${f.long}=+[${desc}]:${f.valueName ?? "value"}:'`;
      }
      if (f.short) {
        return `'${f.short}[${desc}]' '${f.long}[${desc}]'`;
      }
      if (f.takesValue) {
        return `'${f.long}=+[${desc}]:${f.valueName ?? "value"}:'`;
      }
      return `'${f.long}[${desc}]'`;
    })
    .join(" ");
}

function fishQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
