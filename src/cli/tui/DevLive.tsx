/**
 * Ink live controls for an already-running `oke dev` session.
 *
 * Flat single-line chrome (no nested borders / width="100%") so Ink does not
 * remount at a second column count and leave a ghost frame above the bar.
 */

import { Box, Text, useApp, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { mapDevControlInput } from "./keys.ts";
import { TUI_BRAND, TUI_HINT, TUI_MUTED, TUI_WARN } from "./theme.ts";

/** Props for {@link DevLiveControls}. */
export type DevLiveControlsProps = {
  readonly onRefresh: () => void | Promise<void>;
  readonly onComposeUp: () => void | Promise<void>;
  readonly onComposeStop: () => void | Promise<void>;
  readonly onQuit: () => void;
};

/**
 * Compact key-driven controls mounted after `oke dev` boot.
 *
 * @param props - Actions
 */
export function DevLiveControls(props: DevLiveControlsProps): ReactElement {
  const { exit } = useApp();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useInput((input, key) => {
    const ctrl = mapDevControlInput(input, key);
    if (!ctrl || busy) return;
    if (ctrl === "?") {
      setHelp((h) => !h);
      return;
    }
    if (ctrl === "q") {
      props.onQuit();
      exit();
      return;
    }
    if (ctrl === "r") {
      setBusy(true);
      void Promise.resolve(props.onRefresh())
        .then(() => setStatus("refreshed"))
        .catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
      return;
    }
    if (ctrl === "u" || ctrl === "x") {
      setBusy(true);
      const run = ctrl === "u" ? props.onComposeUp : props.onComposeStop;
      void Promise.resolve(run())
        .then(() => setStatus(ctrl === "u" ? "compose up" : "compose stop"))
        .catch((err: unknown) => setStatus(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color={TUI_BRAND}>
          oke dev
        </Text>
        <Text color={TUI_MUTED}> · controls · </Text>
        <Text color={TUI_HINT}>? help · r refresh · q quit · u up · x stop</Text>
        {busy ? <Text color={TUI_WARN}> · working…</Text> : null}
        {status ? <Text color={TUI_MUTED}>{` · ${status}`}</Text> : null}
      </Text>
      {help ? (
        <Text color={TUI_MUTED}>
          r clear/refresh board · q quit · u compose up · x compose stop
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Render {@link DevLiveControls} until quit.
 *
 * Clears Ink's frame before `onRefresh` reprints the hero so stdout + Ink
 * never stack two control boxes.
 *
 * @param props - Actions
 */
export async function launchDevLiveControls(props: DevLiveControlsProps): Promise<void> {
  const React = await import("react");
  const { render } = await import("ink");

  type InkInstance = ReturnType<typeof render>;
  let instance: InkInstance | null = null;

  const afterStdout = async (run: () => void | Promise<void>): Promise<void> => {
    instance?.clear();
    await run();
    if (instance) {
      instance.rerender(React.createElement(DevLiveControls, bound));
    }
  };

  const bound: DevLiveControlsProps = {
    onRefresh: () => afterStdout(props.onRefresh),
    onComposeUp: () => afterStdout(props.onComposeUp),
    onComposeStop: () => afterStdout(props.onComposeStop),
    onQuit: props.onQuit,
  };

  instance = render(React.createElement(DevLiveControls, bound), {
    exitOnCtrlC: false,
  });
  await instance.waitUntilExit();
}
