/**
 * Database panel — 3-column action cards, no nested footer.
 */

import { Box, Text, useInput } from "ink";
import { useState, type ReactElement } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import type { FooterStatus } from "../components/StatusBar.tsx";
import { TUI_ACCENT, TUI_MUTED, TUI_WARN } from "../theme.ts";

/** Props for {@link DatabasePanel}. */
export type DatabasePanelProps = {
  readonly cwd: string;
  readonly active: boolean;
  readonly onLog: (line: string) => void;
  readonly onStatus: (status: FooterStatus) => void;
};

type DbAction = "push" | "generate" | "migrate" | "seed" | "studio";

type Card = {
  readonly id: DbAction;
  readonly key: string;
  readonly title: string;
  readonly blurb: string;
  readonly confirm: boolean;
};

const CARDS: readonly Card[] = [
  {
    id: "push",
    key: "P",
    title: "Push",
    blurb: "sync schema → live DB",
    confirm: true,
  },
  {
    id: "generate",
    key: "G",
    title: "Generate",
    blurb: "write SQL under drizzle/",
    confirm: false,
  },
  {
    id: "migrate",
    key: "M",
    title: "Migrate",
    blurb: "apply pending migrations",
    confirm: true,
  },
  {
    id: "seed",
    key: "E",
    title: "Seed",
    blurb: "run defineSeed",
    confirm: true,
  },
  {
    id: "studio",
    key: "T",
    title: "Studio",
    blurb: "drizzle-kit (browser)",
    confirm: false,
  },
];

/**
 * Database actions as a selectable card grid.
 *
 * @param props - cwd + log sink
 */
export function DatabasePanel(props: DatabasePanelProps): ReactElement {
  const [selected, setSelected] = useState(0);
  const [pending, setPending] = useState<DbAction | null>(null);
  const [busy, setBusy] = useState(false);

  useInput(
    (input, key) => {
      if (!props.active || pending || busy) return;
      if (key.leftArrow) setSelected((i) => Math.max(0, i - 1));
      if (key.rightArrow) setSelected((i) => Math.min(CARDS.length - 1, i + 1));
      if (key.upArrow) setSelected((i) => Math.max(0, i - 3));
      if (key.downArrow) setSelected((i) => Math.min(CARDS.length - 1, i + 3));
      const upper = input.toUpperCase();
      const byKey = CARDS.findIndex((c) => c.key === upper);
      if (byKey >= 0) {
        setSelected(byKey);
        const card = CARDS[byKey]!;
        if (card.confirm) setPending(card.id);
        else void run(card.id);
        return;
      }
      if (key.return) {
        const action = CARDS[selected];
        if (!action) return;
        if (action.confirm) setPending(action.id);
        else void run(action.id);
      }
    },
    { isActive: props.active && !pending && !busy },
  );

  const run = async (id: DbAction): Promise<void> => {
    setBusy(true);
    setPending(null);
    props.onStatus({ kind: "running", label: `Running oke db ${id}…` });
    props.onLog(`oke db ${id}\n`);
    const prevCwd = process.cwd();
    try {
      process.chdir(props.cwd);
      const { dbCli } = await import("../../db.ts");
      const writes: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      console.log = (...args: unknown[]) => {
        writes.push(args.map(String).join(" ") + "\n");
      };
      console.error = (...args: unknown[]) => {
        writes.push(args.map(String).join(" ") + "\n");
      };
      let code = 1;
      try {
        code = await dbCli([id, "--force"]);
      } finally {
        console.log = origLog;
        console.error = origErr;
      }
      for (const w of writes) props.onLog(w);
      props.onStatus({
        kind: "done",
        label: code === 0 ? `db ${id} ok` : `db ${id} exited ${code}`,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      props.onLog(`${m}\n`);
      props.onStatus({ kind: "done", label: m });
    } finally {
      process.chdir(prevCwd);
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <ConfirmDialog
        message={`Run oke db ${pending}? This may change the live database.`}
        onConfirm={() => void run(pending)}
        onCancel={() => setPending(null)}
      />
    );
  }

  const row1 = CARDS.slice(0, 3);
  const row2 = CARDS.slice(3);

  return (
    <Box flexDirection="column" gap={1} flexGrow={1}>
      <Text bold color={TUI_ACCENT}>
        Database
      </Text>
      <Text color={TUI_MUTED} dimColor>
        Domain schema via drizzle-kit
      </Text>
      <Box gap={1}>
        {row1.map((card, i) => (
          <ActionCard key={card.id} card={card} selected={props.active && selected === i} />
        ))}
      </Box>
      <Box gap={1}>
        {row2.map((card, i) => (
          <ActionCard key={card.id} card={card} selected={props.active && selected === i + 3} />
        ))}
      </Box>
      <Text color={TUI_WARN}>! Push & Migrate modify the database — confirmation required</Text>
    </Box>
  );
}

/**
 * One database action card.
 */
function ActionCard(props: { readonly card: Card; readonly selected: boolean }): ReactElement {
  const { card, selected } = props;
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={selected ? TUI_ACCENT : TUI_MUTED}
      width="32%"
      paddingX={1}
    >
      <Text bold color={selected ? TUI_ACCENT : undefined}>
        {selected ? "› " : "  "}[{card.key}] {card.title}
      </Text>
      <Text color={TUI_MUTED}>{card.blurb}</Text>
    </Box>
  );
}
