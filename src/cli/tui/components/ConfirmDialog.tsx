/**
 * Simple y/n confirm overlay for destructive TUI actions.
 */

import { Box, Text, useInput } from "ink";
import type { ReactElement } from "react";
import { TUI_HINT, TUI_OK, TUI_WARN } from "../theme.ts";

/** Props for {@link ConfirmDialog}. */
export type ConfirmDialogProps = {
  readonly message: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

/**
 * Confirm with y / n / Enter / Esc.
 *
 * @param props - Message + callbacks
 */
export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) {
      props.onConfirm();
      return;
    }
    if (input === "n" || input === "N" || key.escape) {
      props.onCancel();
    }
  });
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={TUI_WARN}
      paddingX={1}
      paddingY={0}
    >
      <Text bold color={TUI_WARN}>
        Confirm
      </Text>
      <Text>{props.message}</Text>
      <Text color={TUI_HINT}>
        <Text color={TUI_OK}>y</Text> confirm · <Text color={TUI_WARN}>n</Text> cancel
      </Text>
    </Box>
  );
}
