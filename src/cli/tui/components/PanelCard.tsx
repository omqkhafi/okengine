/**
 * Content card — cyan title, single border for distinct sections only.
 */

import { Box, Text } from "ink";
import type { ReactElement, ReactNode } from "react";
import { TUI_ACCENT, TUI_MUTED } from "../theme.ts";

/** Props for {@link PanelCard}. */
export type PanelCardProps = {
  readonly title: string;
  readonly children: ReactNode;
  readonly flexGrow?: number;
  readonly accent?: boolean;
};

/**
 * Single bordered panel section.
 *
 * @param props - Title + body
 */
export function PanelCard(props: PanelCardProps): ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={props.accent ? TUI_ACCENT : TUI_MUTED}
      paddingX={1}
      paddingY={0}
      flexGrow={props.flexGrow}
      minHeight={3}
    >
      <Text bold color={TUI_ACCENT}>
        {props.title}
      </Text>
      <Box flexDirection="column">{props.children}</Box>
    </Box>
  );
}
