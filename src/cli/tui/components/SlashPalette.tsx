/**
 * `/` command palette — autofill over the full `oke` CLI + panel jumps.
 */

import { Box, Text, useInput } from "ink";
import { useMemo, useState, type ReactElement } from "react";
import {
  commonPrefix,
  filterSlashActions,
  parseSlashArgv,
  type SlashAction,
} from "../slash-catalog.ts";
import { TUI_BRAND, TUI_HINT, TUI_MUTED, TUI_OK, TUI_WARN } from "../theme.ts";

/** Props for {@link SlashPalette}. */
export type SlashPaletteProps = {
  readonly cwd: string;
  readonly onClose: () => void;
  readonly onJumpPanel: (panelId: string) => void;
  readonly onRunCli: (argv: readonly string[]) => void | Promise<void>;
  readonly busy?: boolean;
};

/**
 * Slash palette overlay — type to filter, Tab autofills, Enter runs.
 *
 * @param props - Callbacks
 */
export function SlashPalette(props: SlashPaletteProps): ReactElement {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("");

  const matches = useMemo(() => filterSlashActions(query, 14), [query]);
  const sel = Math.min(selected, Math.max(0, matches.length - 1));
  const active = matches[sel] ?? null;

  useInput(
    (input, key) => {
      if (props.busy) return;

      if (key.escape) {
        props.onClose();
        return;
      }

      if (key.upArrow) {
        setSelected((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelected((i) => Math.min(Math.max(0, matches.length - 1), i + 1));
        return;
      }

      if (key.tab) {
        if (active) {
          const ids = matches.map((m) => m.id);
          const prefix = commonPrefix(ids);
          const next =
            prefix.length > query.length && ids.every((id) => id.startsWith(prefix))
              ? prefix
              : active.id;
          setQuery(next);
          setSelected(0);
          setStatus(`autofill → /${next}`);
        }
        return;
      }

      if (key.return) {
        void submit(active, query);
        return;
      }

      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        setSelected(0);
        setStatus("");
        return;
      }

      if (!input || key.ctrl || key.meta) return;
      // Ignore a second leading `/`; otherwise append printable chars.
      if (input === "/" && query.length === 0) return;
      setQuery((q) => q + input);
      setSelected(0);
      setStatus("");
    },
    { isActive: true },
  );

  const submit = async (action: SlashAction | null, raw: string): Promise<void> => {
    if (action?.kind === "panel" && action.panel) {
      props.onJumpPanel(action.panel);
      props.onClose();
      return;
    }

    if (action?.kind === "cli" && action.argv) {
      const typed = parseSlashArgv(raw);
      const base = action.argv;
      // Append trailing free tokens the user typed beyond the suggestion.
      let argv: readonly string[] = base;
      if (typed.length > base.length && typed.slice(0, base.length).join(" ") === base.join(" ")) {
        argv = typed;
      }
      setStatus(`running oke ${argv.join(" ")}…`);
      await props.onRunCli(argv);
      props.onClose();
      return;
    }

    const argv = parseSlashArgv(raw);
    if (argv.length === 0) {
      setStatus("type a command · Tab to autofill");
      return;
    }
    setStatus(`running oke ${argv.join(" ")}…`);
    await props.onRunCli(argv);
    props.onClose();
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={TUI_BRAND}
      paddingX={1}
      width="100%"
      flexGrow={1}
    >
      <Box>
        <Text bold color={TUI_BRAND}>
          /
        </Text>
        <Text bold>{query}</Text>
        <Text color={TUI_BRAND}>█</Text>
        <Text color={TUI_MUTED}> Tab autofill · ↑↓ · Enter run · Esc</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {matches.length === 0 ? (
          <Text color={TUI_WARN}>No matches — Enter runs free-form `oke …`</Text>
        ) : (
          matches.map((m, i) => {
            const on = i === sel;
            return (
              <Box key={m.id} gap={1}>
                <Text bold={on} color={on ? TUI_BRAND : TUI_MUTED}>
                  {on ? "›" : " "}
                </Text>
                <Text bold={on} color={on ? TUI_BRAND : undefined}>
                  /{m.label}
                </Text>
                <Text color={m.kind === "panel" ? TUI_OK : TUI_MUTED}>
                  {m.kind === "panel" ? "panel" : "cli"}
                </Text>
                <Text color={TUI_MUTED} wrap="truncate">
                  {m.summary}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {status ? <Text color={TUI_HINT}>{status}</Text> : null}
      {props.busy ? <Text color={TUI_WARN}>Running…</Text> : null}
    </Box>
  );
}
