/**
 * Selectable list row with › marker + cyan focus.
 */

import { Text } from "ink";
import type { ReactElement } from "react";
import { TUI_ACCENT, TUI_MUTED } from "../theme.ts";

/** Props for {@link SelectRow}. */
export type SelectRowProps = {
  readonly label: string;
  readonly selected: boolean;
  readonly enabled?: boolean;
};

/**
 * One navigable action/list row.
 *
 * @param props - Label + selection
 */
export function SelectRow(props: SelectRowProps): ReactElement {
  const enabled = props.enabled !== false;
  if (!enabled) {
    return (
      <Text dimColor color={TUI_MUTED}>
        {props.selected ? "› " : "  "}
        {props.label}
      </Text>
    );
  }
  return (
    <Text bold={props.selected} color={props.selected ? TUI_ACCENT : undefined}>
      {props.selected ? "› " : "  "}
      {props.label}
    </Text>
  );
}
