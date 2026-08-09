/**
 * Execute a slash CLI action — spawn `oke` with full argv, stream into logs.
 */

import { resolve } from "node:path";

/**
 * Run `oke <argv…>` in `cwd`, appending stdout/stderr lines via `onLog`.
 *
 * @param cwd - Project root
 * @param argv - Args after `oke`
 * @param onLog - Log sink
 */
export async function runSlashCli(
  cwd: string,
  argv: readonly string[],
  onLog: (line: string) => void,
): Promise<number> {
  const cliEntry = resolve(import.meta.dir, "../index.ts");
  onLog(`$ oke ${argv.join(" ")}\n`);

  // Prefer in-repo entry so local TUI always hits this checkout.
  const proc = Bun.spawn(["bun", cliEntry, ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // Force non-interactive child (no nested TUI).
      OKE_NO_TUI: "1",
    },
  });

  const pump = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) onLog(`${line}\n`);
    }
    if (buf.length > 0) onLog(`${buf}\n`);
  };

  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  const code = await proc.exited;
  onLog(code === 0 ? `✓ exit ${code}\n` : `✗ exit ${code}\n`);
  return code;
}
