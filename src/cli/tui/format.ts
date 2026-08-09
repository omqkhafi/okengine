/**
 * Shared TUI format helpers.
 */

/**
 * Format ms as compact uptime (`4m 21s`).
 *
 * @param ms - Elapsed milliseconds
 */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/**
 * Open a URL in the default browser (best-effort).
 *
 * @param url - http(s) URL
 */
export async function openUrl(url: string): Promise<void> {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } catch {
    // ignore — TUI still shows the link
  }
}
