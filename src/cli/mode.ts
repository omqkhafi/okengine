/**
 * `oke mode` — removed. `oke dev` always uses Docker Compose.
 */

/**
 * CLI entry for deprecated `oke mode`.
 *
 * @param _args - Ignored
 */
export async function modeCli(_args: readonly string[]): Promise<number> {
  void _args;
  console.error("oke mode was removed — `oke dev` always uses Docker Compose");
  return 1;
}
