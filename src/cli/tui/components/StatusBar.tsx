/**
 * Single global footer — shortcuts + transient action status (no own border;
 * the app chrome already frames the shell).
 */

import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { Spinner } from "./Spinner.tsx";
import { TUI_HINT, TUI_MUTED, TUI_OK } from "../theme.ts";

/** Footer mode. */
export type FooterStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly label: string }
  | { readonly kind: "done"; readonly label?: string };

/** Props for {@link StatusBar}. */
export type StatusBarProps = {
  readonly status?: FooterStatus;
  readonly hints?: string;
};

/**
 * Shortcut strip + optional running/done feedback.
 *
 * @param props - Status + hints
 */
export function StatusBar(props: StatusBarProps): ReactElement {
  const hints =
    props.hints ?? "/ command · Tab panels · ↑↓ navigate · Enter action · 1-5 jump · Esc";
  const status = props.status ?? { kind: "idle" as const };

  return (
    <Box paddingX={1} paddingY={0} marginTop={0} justifyContent="space-between">
      <Box>
        {status.kind === "running" ? (
          <Spinner label={status.label} />
        ) : status.kind === "done" ? (
          <Text color={TUI_OK}>✓ {status.label ?? "Done"}</Text>
        ) : (
          <Text color={TUI_HINT}>{hints}</Text>
        )}
      </Box>
      {status.kind !== "idle" ? (
        <Text color={TUI_MUTED} dimColor>
          {hints}
        </Text>
      ) : null}
    </Box>
  );
}
