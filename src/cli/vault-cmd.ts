/**
 * `oke vault` — set · list · import · key rotate.
 */

import { resolve } from "node:path";

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
    for (const line of (await file.text()).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      map.set(key, value);
    }
  }
  return {
    get: (n) => map.get(n),
    set: (n, v) => {
      map.set(n, v);
    },
    names: () => [...map.keys()].sort(),
    async save() {
      const body =
        [...map.entries()].map(([k, v]) => `${k}=${escape(v)}`).join("\n") +
        "\n";
      await Bun.write(path, body);
    },
  };
}

/**
 * Run a vault subcommand.
 *
 * @param args - Args after `vault`
 * @param options - Store injection
 */
export async function vaultCli(
  args: readonly string[],
  options: VaultCmdOptions = {},
): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const [sub, ...rest] = args;
  if (!sub || sub === "--help" || sub === "-h") {
    write(`oke vault set <NAME> [value]
oke vault list
oke vault import <file>
oke vault key rotate
`);
    return sub ? 0 : 1;
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

function escape(value: string): string {
  if (/[\s#"'$\\]/.test(value)) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return value;
}
