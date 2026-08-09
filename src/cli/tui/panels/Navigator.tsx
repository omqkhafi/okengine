/**
 * Project Navigator — Manifest tree with expand/collapse.
 */

import { Box, Text, useInput } from "ink";
import { useEffect, useState, type ReactElement } from "react";
import type { Manifest } from "../../../manifest/types.ts";
import { TUI_ACCENT, TUI_ERR, TUI_MUTED } from "../theme.ts";

/** Props for {@link NavigatorPanel}. */
export type NavigatorPanelProps = {
  readonly cwd: string;
  readonly active: boolean;
};

type NavNode = {
  readonly id: string;
  readonly label: string;
  readonly kind?: "category" | "item" | "meta";
  readonly count?: number;
  readonly children?: readonly NavNode[];
};

/**
 * Build a tree from a Manifest.
 *
 * @param manifest - Parsed/extracted manifest
 */
export function manifestToNavTree(manifest: Manifest): readonly NavNode[] {
  const section = (title: string, record: Record<string, unknown> | undefined): NavNode => {
    const keys = record ? Object.keys(record).sort() : [];
    return {
      id: title,
      label: title,
      kind: "category",
      count: keys.length,
      children: keys.map((name) => ({
        id: `${title}:${name}`,
        label: name,
        kind: "item" as const,
      })),
    };
  };

  const ai = manifest.ai;
  const aiChildren: NavNode[] = [];
  if (ai?.models) {
    const keys = Object.keys(ai.models);
    aiChildren.push({
      id: "ai.models",
      label: "models",
      kind: "category",
      count: keys.length,
      children: keys.map((n) => ({ id: `ai.models:${n}`, label: n, kind: "item" })),
    });
  }
  if (ai?.prompts) {
    const keys = Object.keys(ai.prompts);
    aiChildren.push({
      id: "ai.prompts",
      label: "prompts",
      kind: "category",
      count: keys.length,
      children: keys.map((n) => ({ id: `ai.prompts:${n}`, label: n, kind: "item" })),
    });
  }
  if (ai?.agents) {
    const keys = Object.keys(ai.agents);
    aiChildren.push({
      id: "ai.agents",
      label: "agents",
      kind: "category",
      count: keys.length,
      children: keys.map((n) => ({ id: `ai.agents:${n}`, label: n, kind: "item" })),
    });
  }

  return [
    { id: "app", label: `app: ${manifest.app}`, kind: "meta" },
    section("flows", manifest.flows as Record<string, unknown> | undefined),
    section("signals", manifest.signals as Record<string, unknown> | undefined),
    section("stores", manifest.stores as Record<string, unknown> | undefined),
    section("clocks", manifest.clocks as Record<string, unknown> | undefined),
    section("gates", manifest.gates as Record<string, unknown> | undefined),
    section("vault", manifest.vault as Record<string, unknown> | undefined),
    section("channels", manifest.channels as Record<string, unknown> | undefined),
    {
      id: "ai",
      label: "ai",
      kind: "category",
      count: aiChildren.length,
      children: aiChildren,
    },
  ];
}

/**
 * Flatten tree for arrow-key navigation.
 *
 * @param nodes - Roots
 * @param expanded - Expanded ids
 */
function flatten(
  nodes: readonly NavNode[],
  expanded: ReadonlySet<string>,
  depth = 0,
): readonly { node: NavNode; depth: number }[] {
  const out: { node: NavNode; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children && expanded.has(node.id)) {
      out.push(...flatten(node.children, expanded, depth + 1));
    }
  }
  return out;
}

/**
 * Manifest browser.
 *
 * @param props - cwd
 */
export function NavigatorPanel(props: NavigatorPanelProps): ReactElement {
  const [tree, setTree] = useState<readonly NavNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["flows", "signals", "stores"]),
  );
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { extractManifest } = await import("../../../compiler/extract.ts");
        const manifest = await extractManifest({ rootDir: props.cwd });
        if (!cancelled) {
          setTree(manifestToNavTree(manifest));
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.cwd]);

  const rows = flatten(tree, expanded);

  const toggle = (expand: boolean | "toggle"): void => {
    const row = rows[selected];
    if (!row?.node.children?.length) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (expand === true) next.add(row.node.id);
      else if (expand === false) next.delete(row.node.id);
      else if (next.has(row.node.id)) next.delete(row.node.id);
      else next.add(row.node.id);
      return next;
    });
  };

  useInput(
    (_input, key) => {
      if (!props.active) return;
      if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.downArrow) setSelected((i) => Math.min(Math.max(0, rows.length - 1), i + 1));
      if (key.rightArrow) toggle(true);
      if (key.leftArrow) toggle(false);
      if (key.return) toggle("toggle");
    },
    { isActive: props.active },
  );

  return (
    <Box flexDirection="column" gap={0} flexGrow={1}>
      <Text bold color={TUI_ACCENT}>
        Project Navigator
      </Text>
      <Text color={TUI_MUTED} dimColor>
        Manifest tree · ↑↓ · → expand · ← collapse · Enter toggle
      </Text>
      {error ? <Text color={TUI_ERR}>{error}</Text> : null}
      {rows.map((row, i) => {
        const hasKids = Boolean(row.node.children?.length);
        const open = expanded.has(row.node.id);
        const branch = hasKids ? (open ? "▾ " : "▸ ") : "  ";
        const on = props.active && i === selected;
        const isCategory = row.node.kind === "category";
        return (
          <Text
            key={row.node.id}
            bold={on || isCategory}
            color={on ? TUI_ACCENT : isCategory ? TUI_ACCENT : undefined}
          >
            {"  ".repeat(row.depth)}
            {on ? "› " : "  "}
            {branch}
            {row.node.label}
            {typeof row.node.count === "number" ? (
              <Text color={TUI_MUTED}>{` (${row.node.count})`}</Text>
            ) : null}
          </Text>
        );
      })}
      {rows.length === 0 && !error ? (
        <Text color={TUI_MUTED}>Loading Manifest… extract from src/ or oke.manifest.json</Text>
      ) : null}
    </Box>
  );
}
