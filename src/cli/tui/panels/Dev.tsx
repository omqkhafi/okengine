/**
 * Dev panel — Not Running / Running states, inline shortcuts, live logs.
 */

import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { DevController } from "../../dev-controller.ts";
import type { DevOwnership } from "../../dev-session-lock.ts";
import type { FooterStatus } from "../components/StatusBar.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import { formatUptime } from "../format.ts";
import { mapDevControlInput } from "../keys.ts";
import { pollPortSnapshot, type PortSnapshot } from "../state/ports.ts";
import { TUI_ACCENT, TUI_MUTED, TUI_OK, TUI_WARN } from "../theme.ts";

/** Props for {@link DevPanel}. */
export type DevPanelProps = {
  readonly cwd: string;
  readonly controller: DevController;
  readonly onLog: (line: string) => void;
  readonly active: boolean;
  readonly logs: readonly string[];
  readonly onStatus: (status: FooterStatus) => void;
};

type ActionId = "start" | "stop" | "restart" | "attach";

/**
 * Dev controls panel.
 *
 * @param props - Controller + cwd
 */
export function DevPanel(props: DevPanelProps): ReactElement {
  const [ownership, setOwnership] = useState<DevOwnership>("stopped");
  const [snap, setSnap] = useState<PortSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const off = props.controller.on((e) => {
      if (e.type === "ownership") setOwnership(e.ownership);
      if (e.type === "ready") {
        setOwnership(e.ownership);
        if (e.ownership === "managed") setStartedAt(Date.now());
      }
      if (e.type === "log") props.onLog(e.text);
      if (e.type === "error") {
        props.onLog(`${e.message}\n`);
        props.onStatus({ kind: "done", label: e.message });
      }
      if (e.type === "exit") setStartedAt(null);
    });
    void props.controller.attach(props.cwd).then((r) => {
      setOwnership(r.ownership);
      if (r.ownership === "managed" && r.lock) {
        setStartedAt(Date.parse(r.lock.startedAt) || Date.now());
      }
    });
    return off;
  }, [props.controller, props.cwd, props.onLog, props.onStatus]);

  useEffect(() => {
    const id = setInterval(() => {
      void pollPortSnapshot(props.cwd).then((s) => {
        setOwnership(s.ownership);
        setSnap(s);
      });
      setNow(Date.now());
    }, 1500);
    return () => clearInterval(id);
  }, [props.cwd]);

  const actions = useMemo(() => {
    const running = ownership === "managed";
    const external = ownership === "external";
    return [
      {
        id: "start" as const,
        label: "[S]tart",
        enabled: ownership === "stopped",
      },
      {
        id: "restart" as const,
        label: "[R]estart",
        enabled: running,
      },
      {
        id: "stop" as const,
        label: "[X]top",
        enabled: running,
      },
      {
        id: "attach" as const,
        label: "[A]ttach",
        enabled: true,
      },
    ].filter((a) => !(external && (a.id === "start" || a.id === "restart" || a.id === "stop")));
  }, [ownership]);

  useInput(
    (input, key) => {
      if (!props.active || busy) return;
      const ctrl = mapDevControlInput(input, key);
      if (ctrl === "q") return; // Esc handled by App
      if (ctrl === "r" || input === "r" || input === "R") {
        void runAction("restart");
        return;
      }
      if (input === "s" || input === "S") {
        void runAction("start");
        return;
      }
      if (input === "x" || input === "X") {
        void runAction("stop");
        return;
      }
      if (input === "a" || input === "A") {
        void runAction("attach");
        return;
      }
      if (key.upArrow) {
        setSelected((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelected((i) => Math.min(actions.length - 1, i + 1));
        return;
      }
      if (key.return) {
        const action = actions[selected];
        if (action) void runAction(action.id);
      }
    },
    { isActive: props.active },
  );

  const runAction = async (id: ActionId): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const labels: Record<ActionId, string> = {
      start: "Starting oke dev…",
      stop: "Stopping…",
      restart: "Restarting…",
      attach: "Attaching…",
    };
    props.onStatus({ kind: "running", label: labels[id] });
    try {
      if (id === "start") {
        const code = await props.controller.start({ cwd: props.cwd });
        props.onStatus({
          kind: "done",
          label: code === 0 ? "Started" : "Start failed",
        });
        if (code === 0) setStartedAt(Date.now());
      } else if (id === "stop") {
        await props.controller.stop();
        props.onStatus({ kind: "done", label: "Stopped" });
        setStartedAt(null);
      } else if (id === "restart") {
        if (ownership !== "managed") {
          props.onStatus({ kind: "done", label: "Nothing to restart" });
        } else {
          const code = await props.controller.restart({ cwd: props.cwd });
          props.onStatus({
            kind: "done",
            label: code === 0 ? "Restarted" : "Restart failed",
          });
          if (code === 0) setStartedAt(Date.now());
        }
      } else if (id === "attach") {
        const r = await props.controller.attach(props.cwd);
        setOwnership(r.ownership);
        props.onStatus({ kind: "done", label: `Ownership: ${r.ownership}` });
      }
    } finally {
      setBusy(false);
    }
  };

  const running = ownership === "managed" || ownership === "external";
  const uptime = startedAt && ownership === "managed" ? formatUptime(now - startedAt) : null;
  const app = snap?.surfaces.find((s) => s.id === "app");
  const consoleSurf = snap?.surfaces.find((s) => s.id === "console");
  const logTail = props.logs.slice(-Math.max(6, 12));

  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      <Box flexDirection="column">
        <Text bold color={TUI_ACCENT}>
          Dev Server
        </Text>
        {!running ? (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text color={TUI_WARN} bold>
                ●
              </Text>
              <Text bold color={TUI_WARN}>
                Not Running
              </Text>
            </Box>
            <Text color={TUI_MUTED}>Press [S] to start</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box gap={1}>
              <StatusDot status="ready" />
              <Text bold color={TUI_OK}>
                {ownership === "external" ? "Running (external)" : "Running"}
              </Text>
              {uptime ? <Text color={TUI_MUTED}>· uptime {uptime}</Text> : null}
            </Box>
            <Box gap={2}>
              <Text color={TUI_MUTED}>Ports</Text>
              <Text color={TUI_ACCENT}>App :{app?.port ?? "—"}</Text>
              <Text color={TUI_ACCENT}>Console :{consoleSurf?.port ?? "—"}</Text>
            </Box>
            {ownership === "external" ? (
              <Text color={TUI_WARN}>Read-only — will not start a second stack</Text>
            ) : null}
          </Box>
        )}
      </Box>

      <Box gap={2}>
        {actions.map((a, i) => (
          <Text
            key={a.id}
            bold={props.active && i === selected}
            color={!a.enabled ? TUI_MUTED : props.active && i === selected ? TUI_ACCENT : undefined}
            dimColor={!a.enabled}
          >
            {props.active && i === selected ? "› " : "  "}
            {a.label}
          </Text>
        ))}
      </Box>

      <Box flexDirection="column" flexGrow={1} minHeight={6}>
        <Text bold color={TUI_ACCENT}>
          Live Logs
        </Text>
        {logTail.length === 0 ? (
          <Text color={TUI_MUTED}>Start the dev server to see logs</Text>
        ) : (
          logTail.map((line, i) => (
            <Text key={`${i}-${line.slice(0, 24)}`} wrap="truncate">
              {line.replace(/\n$/, "")}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
