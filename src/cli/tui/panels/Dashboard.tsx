/**
 * Landing panel — OKE wordmark, session, aligned services, quick actions.
 */

import { Box, Text, useInput } from "ink";
import { useEffect, useState, type ReactElement } from "react";
import type { FooterStatus } from "../components/StatusBar.tsx";
import { StatusDot, statusWord } from "../components/StatusDot.tsx";
import { Wordmark } from "../components/Wordmark.tsx";
import { formatUptime, openUrl } from "../format.ts";
import { pollPortSnapshot, type PortSnapshot } from "../state/ports.ts";
import { TUI_ACCENT, TUI_MUTED, TUI_OK, TUI_WARN } from "../theme.ts";

/** Props for {@link DashboardPanel}. */
export type DashboardPanelProps = {
  readonly cwd: string;
  readonly active: boolean;
  readonly onJumpPanel: (panelId: string) => void;
  readonly onStatus: (status: FooterStatus) => void;
};

const ACTIONS = [
  { id: "open", label: "[O]pen Console", key: "o" },
  { id: "mcp", label: "[M]CP Docs", key: "m" },
  { id: "dev", label: "[D]ev Panel", key: "d" },
] as const;

/**
 * Dashboard panel — polls ports every 1.5s.
 *
 * @param props - cwd + focus/actions
 */
export function DashboardPanel(props: DashboardPanelProps): ReactElement {
  const [snap, setSnap] = useState<PortSnapshot | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const next = await pollPortSnapshot(props.cwd);
      if (cancelled) return;
      setSnap(next);
      if (next.ownership === "managed") {
        setStartedAt((prev) => prev ?? Date.now());
      } else {
        setStartedAt(null);
      }
      setNow(Date.now());
    };
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [props.cwd]);

  // Prefer lock startedAt when available via re-read
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { readDevSessionLock } = await import("../../dev-session-lock.ts");
      const lock = await readDevSessionLock(props.cwd);
      if (!cancelled && lock) {
        const t = Date.parse(lock.startedAt);
        if (Number.isFinite(t)) setStartedAt(t);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.cwd, snap?.ownership]);

  useInput(
    (input, key) => {
      if (!props.active) return;
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(ACTIONS.length - 1, i + 1));
      const lower = input.toLowerCase();
      if (lower === "o") void runAction("open");
      else if (lower === "m") void runAction("mcp");
      else if (lower === "d") void runAction("dev");
      else if (key.return) {
        const a = ACTIONS[selected];
        if (a) void runAction(a.id);
      }
    },
    { isActive: props.active },
  );

  const runAction = async (id: (typeof ACTIONS)[number]["id"]): Promise<void> => {
    if (id === "dev") {
      props.onJumpPanel("dev");
      return;
    }
    const consoleSurf = snap?.surfaces.find((s) => s.id === "console");
    const docsSurf = snap?.surfaces.find((s) => s.id === "docsMcp");
    if (id === "open") {
      const url = consoleSurf?.url ?? "http://127.0.0.1:6533";
      props.onStatus({ kind: "running", label: `Opening ${url}…` });
      await openUrl(url);
      props.onStatus({ kind: "done", label: "Opened Console" });
      return;
    }
    const url = docsSurf?.url ?? "http://127.0.0.1:6536";
    props.onStatus({ kind: "running", label: `Opening ${url}…` });
    await openUrl(url);
    props.onStatus({ kind: "done", label: "Opened MCP Docs" });
  };

  const ownership = snap?.ownership ?? "stopped";
  const ownershipLabel =
    ownership === "managed"
      ? "Managed"
      : ownership === "external"
        ? "Connected (external)"
        : "Stopped";
  const ownershipColor = ownership === "managed" || ownership === "external" ? TUI_OK : TUI_WARN;
  const uptime = startedAt && ownership === "managed" ? formatUptime(now - startedAt) : null;

  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      <Box justifyContent="space-between" alignItems="flex-start">
        <Wordmark version="0.10.3" />
      </Box>

      <Box flexDirection="column">
        <Text bold color={TUI_ACCENT}>
          Session
        </Text>
        <Box gap={1}>
          <StatusDot
            status={ownership === "managed" || ownership === "external" ? "ready" : "idle"}
          />
          <Text bold color={ownershipColor}>
            {ownershipLabel}
          </Text>
          {uptime ? <Text color={TUI_MUTED}>· uptime {uptime}</Text> : null}
        </Box>
        {ownership === "external" ? (
          <Text color={TUI_WARN}>Read-only — will not start a second stack</Text>
        ) : null}
        {ownership === "stopped" ? (
          <Text color={TUI_MUTED}>No live oke dev — press [D] or open Dev panel</Text>
        ) : null}
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        <Box>
          <Box width={14}>
            <Text bold color={TUI_ACCENT}>
              Services
            </Text>
          </Box>
          <Box width={8}>
            <Text color={TUI_MUTED}>Port</Text>
          </Box>
          <Box width={10}>
            <Text color={TUI_MUTED}>Status</Text>
          </Box>
          <Text color={TUI_MUTED}>URL</Text>
        </Box>
        <Text color={TUI_MUTED}>{"─".repeat(56)}</Text>
        {(snap?.surfaces ?? []).map((s) => {
          const sw = statusWord(s.status);
          return (
            <Box key={s.id}>
              <Box width={14} gap={1}>
                <StatusDot status={s.status} />
                <Text>{s.label.padEnd(9)}</Text>
              </Box>
              <Box width={8}>
                <Text color={TUI_ACCENT}>{`:${String(s.port).padEnd(5)}`}</Text>
              </Box>
              <Box width={10}>
                <Text color={sw.color}>{sw.word}</Text>
              </Box>
              <Text color={TUI_MUTED}>{s.url}</Text>
            </Box>
          );
        })}
        {!snap ? <Text color={TUI_MUTED}>Probing ports…</Text> : null}
      </Box>

      <Box gap={2}>
        {ACTIONS.map((a, i) => (
          <Text
            key={a.id}
            bold={props.active && i === selected}
            color={props.active && i === selected ? TUI_ACCENT : TUI_MUTED}
          >
            {props.active && i === selected ? "› " : "  "}
            {a.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
