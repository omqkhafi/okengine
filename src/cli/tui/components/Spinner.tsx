/**
 * Lightweight terminal spinner (no extra deps).
 */

import { Text } from "ink";
import { useEffect, useState, type ReactElement } from "react";
import { TUI_WARN } from "../theme.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Props for {@link Spinner}. */
export type SpinnerProps = {
  readonly label?: string;
};

/**
 * Animated spinner + optional label.
 *
 * @param props - Label
 */
export function Spinner(props: SpinnerProps): ReactElement {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Text color={TUI_WARN}>
      {FRAMES[i]} {props.label ?? "Working…"}
    </Text>
  );
}
