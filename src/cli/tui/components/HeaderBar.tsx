/**
 * Compact project chrome — no border (spacing separates).
 */

import { Box, Text } from "ink";
import { useEffect, useState, type ReactElement } from "react";
import { basename } from "node:path";
import { TUI_ACCENT, TUI_MUTED, TUI_WARN } from "../theme.ts";

/** Props for {@link HeaderBar}. */
export type HeaderBarProps = {
  readonly cwd: string;
};

async function resolveBranch(cwd: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return "dev";
    const name = out.trim();
    return name.length > 0 && name !== "HEAD" ? name : "dev";
  } catch {
    return "dev";
  }
}

/**
 * Project · branch · path.
 *
 * @param props - cwd
 */
export function HeaderBar(props: HeaderBarProps): ReactElement {
  const [branch, setBranch] = useState("dev");
  const project = basename(props.cwd) || props.cwd;

  useEffect(() => {
    let cancelled = false;
    void resolveBranch(props.cwd).then((b) => {
      if (!cancelled) setBranch(b);
    });
    return () => {
      cancelled = true;
    };
  }, [props.cwd]);

  const home = process.env["HOME"] ?? "";
  const shortCwd =
    home && props.cwd.startsWith(home) ? `~${props.cwd.slice(home.length)}` : props.cwd;

  return (
    <Box paddingX={1} paddingY={0} marginBottom={0}>
      <Text bold color={TUI_ACCENT}>
        {project}
      </Text>
      <Text color={TUI_MUTED}> · </Text>
      <Text color={TUI_WARN}>{branch}</Text>
      <Text color={TUI_MUTED}> · </Text>
      <Text color={TUI_MUTED} wrap="truncate">
        {shortCwd}
      </Text>
    </Box>
  );
}
