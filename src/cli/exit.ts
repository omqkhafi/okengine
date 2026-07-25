/**
 * `oke` CLI exit codes — gflows-aligned 0/1/2 convention.
 */

/** Success. */
export const EXIT_OK = 0;

/** Usage / validation error (missing args, unknown command, bad flags). */
export const EXIT_USAGE = 1;

/** Runtime / environment / check failure (doctor findings, missing config, I/O). */
export const EXIT_RUNTIME = 2;

/** Human-readable exit-code table for `oke help` / README. */
export const EXIT_CODE_HELP = `Exit codes:
  0  success
  1  usage / validation
  2  runtime / environment / check failure
` as const;
