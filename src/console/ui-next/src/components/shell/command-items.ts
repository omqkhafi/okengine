/**
 * Default Console command-palette catalog.
 */

import {
  AccessIcon,
  Archive02Icon,
  ChartAnalysisIcon,
  ComputerIcon,
  Logout03Icon,
  Moon02Icon,
  Settings01Icon,
  Shapes01Icon,
  Sun03Icon,
  WorkflowSquare08Icon,
} from "@hugeicons/core-free-icons";
import type { CommandItem } from "@/components/shell/command-palette.tsx";
import type { Theme } from "@/components/theme-provider";
import {
  lastSearchFor,
  type ConsoleModulePath,
  type LastModuleSearch,
} from "@/lib/last-module-search.ts";
import { consoleShortcut, type ConsoleShortcutId } from "@/lib/shortcut.ts";

const MODULES: ReadonlyArray<{
  readonly title: string;
  readonly to: ConsoleModulePath;
  readonly icon: typeof WorkflowSquare08Icon;
  readonly keywords: readonly string[];
  readonly shortcut: Exclude<ConsoleShortcutId, "fast" | "settings" | "logout">;
}> = [
  {
    title: "Overview",
    to: "/overview",
    icon: WorkflowSquare08Icon,
    keywords: ["home", "traces"],
    shortcut: "overview",
  },
  {
    title: "Flows",
    to: "/flows",
    icon: Shapes01Icon,
    keywords: ["units", "call"],
    shortcut: "flows",
  },
  {
    title: "Store",
    to: "/store",
    icon: Archive02Icon,
    keywords: ["sql", "kv", "files"],
    shortcut: "store",
  },
  {
    title: "Observability",
    to: "/observability",
    icon: ChartAnalysisIcon,
    keywords: ["runs", "metrics", "monitoring"],
    shortcut: "observability",
  },
  {
    title: "Vault",
    to: "/vault",
    icon: AccessIcon,
    keywords: ["secrets", "contracts"],
    shortcut: "vault",
  },
];

/** Inputs for {@link consoleCommandItems}. */
export interface ConsoleCommandItemsInput {
  readonly memory: LastModuleSearch;
  readonly go: (path: ConsoleModulePath, search: Record<string, unknown>) => void;
  readonly openSettings: () => void;
  readonly logout: () => void;
  readonly setTheme: (theme: Theme) => void;
}

/**
 * Navigate / appearance / account commands for the shell palette.
 *
 * @param input - Navigation and account actions
 */
export function consoleCommandItems(input: ConsoleCommandItemsInput): CommandItem[] {
  const navigate: CommandItem[] = MODULES.map((mod) => ({
    id: `go:${mod.to}`,
    label: mod.title,
    group: "Navigate",
    keys: consoleShortcut(mod.shortcut),
    keywords: mod.keywords,
    icon: mod.icon,
    onSelect: () => input.go(mod.to, lastSearchFor(input.memory, mod.to)),
  }));

  const appearance: CommandItem[] = [
    {
      id: "theme:light",
      label: "Light",
      group: "Appearance",
      keywords: ["theme", "day"],
      icon: Sun03Icon,
      onSelect: () => input.setTheme("light"),
    },
    {
      id: "theme:dark",
      label: "Dark",
      group: "Appearance",
      keywords: ["theme", "night"],
      icon: Moon02Icon,
      onSelect: () => input.setTheme("dark"),
    },
    {
      id: "theme:system",
      label: "System",
      group: "Appearance",
      keywords: ["theme", "auto"],
      icon: ComputerIcon,
      onSelect: () => input.setTheme("system"),
    },
  ];

  const account: CommandItem[] = [
    {
      id: "settings",
      label: "Settings",
      group: "Account",
      keys: consoleShortcut("settings"),
      keywords: ["preferences", "operator"],
      icon: Settings01Icon,
      onSelect: input.openSettings,
    },
    {
      id: "logout",
      label: "Logout",
      group: "Account",
      keys: consoleShortcut("logout"),
      keywords: ["sign out", "exit"],
      icon: Logout03Icon,
      onSelect: input.logout,
    },
  ];

  return [...navigate, ...appearance, ...account];
}
