/**
 * Top-level panel tabs — green active chip, no enclosing border.
 */

import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { TUI_BRAND, TUI_MUTED } from "../theme.ts";

/** One tab descriptor. */
export type TabItem = {
  readonly id: string;
  readonly label: string;
};

/** Props for {@link TabBar}. */
export type TabBarProps = {
  readonly tabs: readonly TabItem[];
  readonly activeIndex: number;
  /** When true, tab strip owns focus (reserved for future emphasis). */
  readonly focused?: boolean;
};

/**
 * Horizontal tab bar.
 *
 * @param props - Tabs + selection
 */
export function TabBar(props: TabBarProps): ReactElement {
  return (
    <Box paddingX={1} gap={0}>
      {props.tabs.map((tab, i) => {
        const active = i === props.activeIndex;
        const label = `  ${i + 1} ${tab.label}  `;
        if (active) {
          return (
            <Text key={tab.id} backgroundColor={TUI_BRAND} color="black" bold>
              {label}
            </Text>
          );
        }
        return (
          <Text key={tab.id} color={TUI_MUTED}>
            {label}
          </Text>
        );
      })}
    </Box>
  );
}
