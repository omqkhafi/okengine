/**
 * Ink readiness glyph for {@link DevStatus}.
 */

import { Text } from "ink";
import type { ReactElement } from "react";
import type { DevStatus } from "../../../term.ts";
import { TUI_ERR, TUI_OK, TUI_WARN } from "../theme.ts";

/** Props for {@link StatusDot}. */
export type StatusDotProps = {
  readonly status: DevStatus;
};

/**
 * ● online/pending/error · ○ offline (yellow/red, not gray).
 *
 * @param props - Status
 */
export function StatusDot(props: StatusDotProps): ReactElement {
  if (props.status === "idle") {
    return <Text color={TUI_WARN}>○</Text>;
  }
  const color = props.status === "ready" ? TUI_OK : props.status === "pending" ? TUI_WARN : TUI_ERR;
  return <Text color={color}>●</Text>;
}

/** Fixed-width status word. */
export function statusWord(status: DevStatus): {
  readonly word: string;
  readonly color: typeof TUI_OK | typeof TUI_WARN | typeof TUI_ERR;
} {
  if (status === "ready") return { word: "online ", color: TUI_OK };
  if (status === "pending") return { word: "start  ", color: TUI_WARN };
  if (status === "error") return { word: "error  ", color: TUI_ERR };
  return { word: "offline", color: TUI_WARN };
}
