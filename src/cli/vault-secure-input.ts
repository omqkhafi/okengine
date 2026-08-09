/**
 * Secure master-key input for `oke vault` — avoid shell history.
 *
 * Prefer `--key -` (stdin) or an interactive hidden prompt over putting
 * base64 keys on the argv in shared environments.
 */

/** Minimal readable stream used by {@link readStdinSecure}. */
export interface SecureStdin {
  setEncoding?(encoding: BufferEncoding): void;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Minimal TTY-ish stdin used by {@link promptHidden}. */
export interface SecurePromptStdin {
  setRawMode?(mode: boolean): void;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  removeListener?(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  off?(event: "data", listener: (chunk: string | Buffer) => void): unknown;
}

/** IO sinks for {@link promptHidden}. */
export interface PromptHiddenOptions {
  /** Prompt destination. Defaults to `process.stdout.write`. */
  readonly write?: (text: string) => void;
  /** Character stream (TTY). Defaults to `process.stdin`. */
  readonly stdin?: SecurePromptStdin;
  /** Exit handler for Ctrl+C. Defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
}

/**
 * Read a trimmed secret from stdin (for `--key -` / `--new-key -`).
 *
 * @param stdin - Readable stream; defaults to `process.stdin`
 */
export async function readStdinSecure(stdin: SecureStdin = process.stdin): Promise<string> {
  stdin.setEncoding?.("utf8");
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.on("data", (chunk) => {
      data += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    stdin.on("end", () => resolve(data.trim()));
    stdin.on("error", reject);
  });
}

/**
 * Prompt for a secret on a TTY without echoing the cleartext.
 *
 * Characters are masked with `*`. Backspace edits; Enter submits; Ctrl+C
 * exits the process (or the injected `exit` handler).
 *
 * @param question - Prompt text written before input
 * @param options - Injectable IO for tests
 */
export async function promptHidden(
  question: string,
  options: PromptHiddenOptions = {},
): Promise<string> {
  const write = options.write ?? ((t: string) => process.stdout.write(t));
  const stdin = options.stdin ?? process.stdin;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  write(question);
  stdin.setRawMode?.(true);

  return new Promise((resolve) => {
    let input = "";
    const onData = (char: string | Buffer): void => {
      const text = typeof char === "string" ? char : char.toString("utf8");
      for (const ch of text) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          stdin.setRawMode?.(false);
          write("\n");
          removeDataListener(stdin, onData);
          resolve(input);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode?.(false);
          write("\n");
          removeDataListener(stdin, onData);
          exit(1);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            write("\b \b");
          }
          continue;
        }
        // Ignore other control characters.
        if (ch < " ") continue;
        input += ch;
        write("*");
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * Detach the raw-mode data listener when the host supports it.
 *
 * @param stdin - Prompt stdin
 * @param listener - Handler to remove
 */
function removeDataListener(
  stdin: SecurePromptStdin,
  listener: (chunk: string | Buffer) => void,
): void {
  if (typeof stdin.off === "function") {
    stdin.off("data", listener);
    return;
  }
  if (typeof stdin.removeListener === "function") {
    stdin.removeListener("data", listener);
  }
}
