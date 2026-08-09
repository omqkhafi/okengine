/**
 * Persistent log footer — last N lines from the active service.
 */

import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { TUI_MUTED } from "../theme.ts";

/** Props for {@link LogStream}. */
export type LogStreamProps = {
  readonly lines: readonly string[];
  readonly max?: number;
  readonly title?: string;
};

/**
 * Scrollable-ish log tail (shows last `max` lines).
 *
 * @param props - Lines + title
 */
export function LogStream(props: LogStreamProps): ReactElement {
  const max = props.max ?? 6;
  const tail = props.lines.slice(-max);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={TUI_MUTED}
      paddingX={1}
      minHeight={4}
      flexGrow={0}
    >
      <Text bold color={TUI_MUTED}>
        {props.title ?? "Logs"}
      </Text>
      {tail.length === 0 ? (
        <Text color={TUI_MUTED}>(quiet)</Text>
      ) : (
        tail.map((line, i) => (
          <Text key={`${i}-${line.slice(0, 24)}`} wrap="truncate">
            {line.replace(/\n$/, "")}
          </Text>
        ))
      )}
    </Box>
  );
}
