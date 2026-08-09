/**
 * Interactive `oke` shell — brand chrome, focus layers, `/` palette.
 */

import { Box, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { DevController } from "../dev-controller.ts";
import type { DevOwnership } from "../dev-session-lock.ts";
import { ConfirmDialog } from "./components/ConfirmDialog.tsx";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { SlashPalette } from "./components/SlashPalette.tsx";
import { StatusBar, type FooterStatus } from "./components/StatusBar.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { DashboardPanel } from "./panels/Dashboard.tsx";
import { DatabasePanel } from "./panels/Database.tsx";
import { DevPanel } from "./panels/Dev.tsx";
import { DockerPanel } from "./panels/Docker.tsx";
import { NavigatorPanel } from "./panels/Navigator.tsx";
import { runSlashCli } from "./slash-run.ts";
import { pollPortSnapshot } from "./state/ports.ts";
import { TUI_MUTED } from "./theme.ts";

const PANELS = ["dashboard", "dev", "database", "docker", "navigator"] as const;
type PanelId = (typeof PANELS)[number];

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "dev", label: "Dev" },
  { id: "database", label: "Database" },
  { id: "docker", label: "Docker" },
  { id: "navigator", label: "Navigator" },
] as const;

/** Props for {@link OkeTuiApp}. */
export type OkeTuiAppProps = {
  readonly cwd: string;
};

/**
 * Root Ink application.
 *
 * @param props - cwd
 */
export function OkeTuiApp(props: OkeTuiAppProps): ReactElement {
  const { exit } = useApp();
  const [panelIndex, setPanelIndex] = useState(0);
  const [focusLayer, setFocusLayer] = useState<"tabs" | "panel">("tabs");
  const [logs, setLogs] = useState<string[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashBusy, setSlashBusy] = useState(false);
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [ownership, setOwnership] = useState<DevOwnership>("stopped");
  const [footerStatus, setFooterStatus] = useState<FooterStatus>({ kind: "idle" });
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useMemo(() => new DevController(), []);

  const onLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, ...line.split("\n").filter((l) => l.length > 0)];
      return next.slice(-200);
    });
  }, []);

  const onStatus = useCallback((status: FooterStatus) => {
    if (doneTimer.current) {
      clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
    setFooterStatus(status);
    if (status.kind === "done") {
      doneTimer.current = setTimeout(() => {
        setFooterStatus({ kind: "idle" });
        doneTimer.current = null;
      }, 2000);
    }
  }, []);

  useEffect(() => {
    const tick = (): void => {
      void pollPortSnapshot(props.cwd).then((s) => setOwnership(s.ownership));
    };
    tick();
    const id = setInterval(tick, 2000);
    const off = controller.on((e) => {
      if (e.type === "ownership" || e.type === "ready") {
        setOwnership(e.ownership);
      }
      if (e.type === "exit") setOwnership("stopped");
    });
    return () => {
      clearInterval(id);
      off();
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [controller, props.cwd]);

  const panel = (PANELS[panelIndex] ?? "dashboard") as PanelId;
  const panelActive = !slashOpen && !quitConfirm && focusLayer === "panel";

  const jumpPanel = useCallback((panelId: string) => {
    const idx = PANELS.indexOf(panelId as PanelId);
    if (idx >= 0) {
      setPanelIndex(idx);
      setFocusLayer("panel");
    }
  }, []);

  const runCli = useCallback(
    async (argv: readonly string[]) => {
      setSlashBusy(true);
      onStatus({ kind: "running", label: `Running oke ${argv.join(" ")}…` });
      try {
        await runSlashCli(props.cwd, argv, onLog);
        onStatus({ kind: "done", label: "Done" });
      } catch {
        onStatus({ kind: "done", label: "Failed" });
      } finally {
        setSlashBusy(false);
      }
    },
    [props.cwd, onLog, onStatus],
  );

  const requestQuit = useCallback(() => {
    if (ownership === "managed") {
      setQuitConfirm(true);
      return;
    }
    exit();
  }, [ownership, exit]);

  useInput((input, key) => {
    if (slashOpen || quitConfirm) return;

    if (key.escape) {
      if (focusLayer === "panel") {
        setFocusLayer("tabs");
        return;
      }
      requestQuit();
      return;
    }
    if (input === "/") {
      setSlashOpen(true);
      return;
    }
    const n = Number(input);
    if (n >= 1 && n <= PANELS.length) {
      setPanelIndex(n - 1);
      return;
    }
    // Global panel switch: Tab always; ←→ when focus is on the tab strip.
    if (key.tab) {
      setPanelIndex((i) => (i + 1) % PANELS.length);
      setFocusLayer("tabs");
      return;
    }
    if (focusLayer === "tabs") {
      if (key.leftArrow) {
        setPanelIndex((i) => (i - 1 + PANELS.length) % PANELS.length);
        return;
      }
      if (key.rightArrow) {
        setPanelIndex((i) => (i + 1) % PANELS.length);
        return;
      }
      if (key.downArrow || key.return) {
        setFocusLayer("panel");
      }
    }
  });

  if (quitConfirm) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={TUI_MUTED}
        width="100%"
        padding={1}
      >
        <ConfirmDialog
          message="Stop managed oke dev and quit TUI?"
          onConfirm={() => {
            void controller.stop().then(() => exit());
          }}
          onCancel={() => setQuitConfirm(false)}
        />
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={TUI_MUTED}
      width="100%"
      paddingX={1}
      paddingY={0}
    >
      <Box paddingY={1}>
        <HeaderBar cwd={props.cwd} />
      </Box>
      <TabBar tabs={TABS} activeIndex={panelIndex} focused={focusLayer === "tabs"} />

      {slashOpen ? (
        <Box marginTop={1} flexGrow={1} minHeight={10}>
          <SlashPalette
            cwd={props.cwd}
            busy={slashBusy}
            onClose={() => setSlashOpen(false)}
            onJumpPanel={jumpPanel}
            onRunCli={runCli}
          />
        </Box>
      ) : (
        <Box flexDirection="column" flexGrow={1} marginTop={1} minHeight={10} gap={1}>
          {panel === "dashboard" ? (
            <DashboardPanel
              cwd={props.cwd}
              active={panelActive}
              onJumpPanel={jumpPanel}
              onStatus={onStatus}
            />
          ) : null}
          {panel === "dev" ? (
            <DevPanel
              cwd={props.cwd}
              controller={controller}
              onLog={onLog}
              logs={logs}
              active={panelActive}
              onStatus={onStatus}
            />
          ) : null}
          {panel === "database" ? (
            <DatabasePanel cwd={props.cwd} active={panelActive} onLog={onLog} onStatus={onStatus} />
          ) : null}
          {panel === "docker" ? (
            <DockerPanel cwd={props.cwd} active={panelActive} onLog={onLog} onStatus={onStatus} />
          ) : null}
          {panel === "navigator" ? <NavigatorPanel cwd={props.cwd} active={panelActive} /> : null}
        </Box>
      )}

      <Box marginTop={0}>
        <StatusBar status={footerStatus} />
      </Box>
    </Box>
  );
}
