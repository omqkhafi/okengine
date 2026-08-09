/**
 * Docker panel — live stack by project name; clean tears down whole projects.
 *
 * Never shells into interactive `oke docker clean` (clack) while Ink is mounted —
 * that fights stdout and leaves ghost frames.
 */

import { Box, Text, useInput } from "ink";
import { useEffect, useState, type ReactElement } from "react";
import type { DevStatus } from "../../../term.ts";
import { composeRowToStatus } from "../../../docker/compose-health.ts";
import {
  composeProjectName,
  downStack,
  listOkeComposeProjects,
  listStackContainers,
  type OkeStack,
} from "../../../docker/cleanup.ts";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import type { FooterStatus } from "../components/StatusBar.tsx";
import { StatusDot, statusWord } from "../components/StatusDot.tsx";
import { TUI_ACCENT, TUI_MUTED, TUI_OK, TUI_WARN } from "../theme.ts";

/** Props for {@link DockerPanel}. */
export type DockerPanelProps = {
  readonly cwd: string;
  readonly active: boolean;
  readonly onLog: (line: string) => void;
  readonly onStatus: (status: FooterStatus) => void;
};

type DockerAction = "derive" | "clean" | "restart";

type ServiceRow = {
  readonly name: string;
  readonly status: DevStatus;
  readonly detail: string;
};

type Mode = "main" | "pickClean" | "confirmClean";

/**
 * Compose-oriented panel.
 *
 * @param props - cwd + log
 */
export function DockerPanel(props: DockerPanelProps): ReactElement {
  const project = composeProjectName(props.cwd);
  const [rows, setRows] = useState<readonly ServiceRow[]>([]);
  const [stacks, setStacks] = useState<readonly OkeStack[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("main");
  const [cleanFocus, setCleanFocus] = useState(0);
  const [cleanPicked, setCleanPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const actions: readonly { id: DockerAction; label: string }[] = [
    { id: "derive", label: "[D]erive" },
    { id: "clean", label: "[C]lean" },
    { id: "restart", label: "[R]estart stack" },
  ];

  const refresh = async (): Promise<void> => {
    try {
      const containers = await listStackContainers(project);
      setRows(
        containers.map((c) => ({
          name: c.service || c.name,
          status: composeRowToStatus({
            Service: c.service,
            State: c.state,
            Status: c.state,
          }),
          detail: c.state || c.name,
        })),
      );
      const all = await listOkeComposeProjects();
      setStacks(all);
    } catch (err) {
      props.onLog(`${err instanceof Error ? err.message : String(err)}\n`);
    }
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [props.cwd]);

  useInput(
    (input, key) => {
      if (!props.active || busy) return;

      if (mode === "pickClean") {
        if (key.escape) {
          setMode("main");
          return;
        }
        if (key.upArrow) setCleanFocus((i) => Math.max(0, i - 1));
        if (key.downArrow) setCleanFocus((i) => Math.min(Math.max(0, stacks.length - 1), i + 1));
        if (input === " ") {
          const stack = stacks[cleanFocus];
          if (!stack) return;
          setCleanPicked((prev) => {
            const next = new Set(prev);
            if (next.has(stack.project)) next.delete(stack.project);
            else next.add(stack.project);
            return next;
          });
          return;
        }
        if (key.return) {
          if (cleanPicked.size === 0) return;
          setMode("confirmClean");
        }
        return;
      }

      if (mode !== "main") return;

      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(actions.length - 1, i + 1));
      const lower = input.toLowerCase();
      if (lower === "d") void run("derive");
      else if (lower === "c") void beginClean();
      else if (lower === "r") void run("restart");
      else if (key.return) {
        const a = actions[selected];
        if (!a) return;
        if (a.id === "clean") void beginClean();
        else void run(a.id);
      }
    },
    { isActive: props.active && mode !== "confirmClean" },
  );

  const beginClean = async (): Promise<void> => {
    try {
      const all = await listOkeComposeProjects();
      setStacks(all);
      if (all.length === 0) {
        props.onStatus({ kind: "done", label: "No oke-dev-* stacks" });
        return;
      }
      const initial = new Set<string>();
      if (all.some((s) => s.project === project)) initial.add(project);
      else if (all[0]) initial.add(all[0].project);
      setCleanPicked(initial);
      setCleanFocus(
        Math.max(
          0,
          all.findIndex((s) => s.project === project),
        ),
      );
      setMode("pickClean");
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      props.onLog(`${m}\n`);
      props.onStatus({ kind: "done", label: m });
    }
  };

  const runClean = async (): Promise<void> => {
    setBusy(true);
    setMode("main");
    const targets = [...cleanPicked].sort();
    props.onStatus({
      kind: "running",
      label: `Removing ${targets.length} stack(s)…`,
    });
    try {
      for (const p of targets) {
        props.onLog(`oke docker clean: down -v ${p}\n`);
        await downStack(p);
      }
      props.onStatus({
        kind: "done",
        label: `Removed ${targets.length} stack(s)`,
      });
      await refresh();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      props.onLog(`${m}\n`);
      props.onStatus({ kind: "done", label: m });
    } finally {
      setBusy(false);
    }
  };

  const run = async (id: Exclude<DockerAction, "clean">): Promise<void> => {
    setBusy(true);
    const labels = {
      derive: "Running oke docker…",
      restart: `Restarting ${project}…`,
    } as const;
    props.onStatus({ kind: "running", label: labels[id] });
    try {
      if (id === "derive") {
        const { dockerCli } = await import("../../docker.ts");
        const prev = process.cwd();
        process.chdir(props.cwd);
        let code = 1;
        try {
          code = await dockerCli([]);
        } finally {
          process.chdir(prev);
        }
        props.onLog(`oke docker → ${code}\n`);
        props.onStatus({
          kind: "done",
          label: code === 0 ? "Derive ok" : `Derive exited ${code}`,
        });
      } else {
        const proc = Bun.spawn(["docker", "compose", "-p", project, "restart"], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (stdout) props.onLog(stdout);
        if (stderr) props.onLog(stderr);
        props.onStatus({
          kind: "done",
          label: code === 0 ? "Stack restarted" : `Restart exited ${code}`,
        });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (mode === "confirmClean") {
    const list = [...cleanPicked].sort().join(", ");
    return (
      <ConfirmDialog
        message={`Remove stack(s) — containers, networks, volumes?\n${list}`}
        onConfirm={() => void runClean()}
        onCancel={() => setMode("pickClean")}
      />
    );
  }

  if (mode === "pickClean") {
    return (
      <Box flexDirection="column" gap={1} flexGrow={1}>
        <Text bold color={TUI_ACCENT}>
          Clean stacks
        </Text>
        <Text color={TUI_MUTED} dimColor>
          Space toggle · Enter confirm · Esc cancel — whole project, not per-service
        </Text>
        {stacks.length === 0 ? (
          <Text color={TUI_WARN}>No oke-dev-* stacks on this machine</Text>
        ) : (
          stacks.map((s, i) => {
            const on = i === cleanFocus;
            const picked = cleanPicked.has(s.project);
            const n = s.containers.length;
            const current = s.project === project;
            return (
              <Text key={s.project} bold={on} color={on ? TUI_ACCENT : undefined}>
                {on ? "› " : "  "}
                {picked ? "●" : "○"} {s.project}
                <Text color={TUI_MUTED}>
                  {`  ${n} container${n === 1 ? "" : "s"}`}
                  {current ? "  · this project" : ""}
                </Text>
              </Text>
            );
          })
        )}
      </Box>
    );
  }

  const online = rows.filter((r) => r.status === "ready").length;
  const total = rows.length;
  const allOnline = total > 0 && online === total;
  const stackKnown = stacks.some((s) => s.project === project);

  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      <Text bold color={TUI_ACCENT}>
        Docker Compose
      </Text>
      <Box gap={1}>
        <StatusDot status={allOnline ? "ready" : total === 0 ? "idle" : "pending"} />
        <Text bold color={allOnline ? TUI_OK : TUI_WARN}>
          {total === 0
            ? stackKnown
              ? `0 services · ${project}`
              : `No stack · ${project}`
            : `${online}/${total} services online`}
        </Text>
        {total > 0 ? <Text color={TUI_MUTED}>· {project}</Text> : null}
      </Box>

      <Box>
        <Box width={22}>
          <Text bold color={TUI_MUTED}>
            Service
          </Text>
        </Box>
        <Box width={10}>
          <Text bold color={TUI_MUTED}>
            Status
          </Text>
        </Box>
        <Text bold color={TUI_MUTED}>
          Detail
        </Text>
      </Box>
      <Text color={TUI_MUTED}>{"─".repeat(48)}</Text>

      {rows.length === 0 ? (
        <Text color={TUI_MUTED}>
          No containers for {project}. Start `oke dev` or run [D]erive + compose up.
        </Text>
      ) : (
        rows.map((r) => {
          const sw = statusWord(r.status);
          return (
            <Box key={r.name}>
              <Box width={22} gap={1}>
                <StatusDot status={r.status} />
                <Text>{r.name}</Text>
              </Box>
              <Box width={10}>
                <Text color={sw.color}>{sw.word}</Text>
              </Box>
              <Text color={TUI_MUTED}>{r.detail}</Text>
            </Box>
          );
        })
      )}

      <Box gap={2} marginTop={1}>
        {actions.map((a, i) => (
          <Text
            key={a.id}
            bold={props.active && i === selected}
            color={
              props.active && i === selected ? TUI_ACCENT : a.id === "clean" ? TUI_WARN : undefined
            }
          >
            {props.active && i === selected ? "› " : "  "}
            {a.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
