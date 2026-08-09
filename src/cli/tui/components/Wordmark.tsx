/**
 * OKE ASCII wordmark — same art as `oke dev` / {@link formatOkeWordmark}.
 */

import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { TUI_BRAND, TUI_MUTED } from "../theme.ts";

/** Plain wordmark lines (no ANSI) — matches `formatOkeWordmark`. */
export const OKE_WORDMARK_LINES: readonly string[] = [
  "   ██████╗ ██╗  ██╗███████╗",
  "  ██╔═══██╗██║ ██╔╝██╔════╝",
  "  ██║   ██║█████╔╝ █████╗  ",
  "  ██║   ██║██╔═██╗ ██╔══╝  ",
  "  ╚██████╔╝██║  ██╗███████╗",
  "   ╚═════╝ ╚═╝  ╚═╝╚══════╝",
];

/** Props for {@link Wordmark}. */
export type WordmarkProps = {
  readonly version?: string;
};

/**
 * Green block-letter OKE + version.
 *
 * @param props - Optional pinned version
 */
export function Wordmark(props: WordmarkProps): ReactElement {
  const version = props.version ?? "0.10.3";
  return (
    <Box flexDirection="column">
      {OKE_WORDMARK_LINES.map((line) => (
        <Text key={line} bold color={TUI_BRAND}>
          {line}
        </Text>
      ))}
      <Text color={TUI_MUTED}>
        {"  "}v{version}
      </Text>
    </Box>
  );
}
