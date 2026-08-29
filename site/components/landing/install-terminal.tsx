/**
 * Install terminal — tabbed CLI widget for the hero README band.
 * Commands mirror `site/content/docs/understand/the-anatomy.mdx`; the port
 * table is the same one the docs publish (O·K·E = 6·5·3).
 */

"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { PORTS } from "@/lib/elements";
import { cn } from "@/lib/cn";

type TerminalTab = {
  readonly id: string;
  readonly label: string;
  readonly commands: ReadonlyArray<string>;
  readonly output: ReadonlyArray<{ readonly label: string; readonly value: string }>;
};

const TABS: ReadonlyArray<TerminalTab> = [
  {
    id: "scaffold",
    label: "Scaffold",
    commands: ["bunx create-oke@latest my-app"],
    output: [
      { label: "template", value: "standard — recommended project layout" },
      { label: "next", value: "cd my-app && oke dev" },
    ],
  },
  {
    id: "install",
    label: "Install",
    commands: ["bun add okengine"],
    output: [
      { label: "exports", value: "on flow signal store clock gate vault channel ai plugin" },
      { label: "cli", value: "oke" },
    ],
  },
  {
    id: "run",
    label: "Run",
    commands: ["oke dev"],
    output: PORTS.map((p) => ({
      label: p.surface.toLowerCase(),
      value: `http://localhost:${p.port}`,
    })),
  },
];

/**
 * Terminal-styled tab strip with copyable commands and the surfaces each one
 * brings up.
 */
export function InstallTerminal() {
  const [activeId, setActiveId] = useState<string>(TABS[0]!.id);
  const [copied, setCopied] = useState(false);
  const active = TABS.find((tab) => tab.id === activeId) ?? TABS[0]!;

  async function copyCommands() {
    try {
      await navigator.clipboard.writeText(active.commands.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card">
      <div className="flex items-center justify-between gap-2 border-b border-fd-border pl-2">
        <div role="tablist" aria-label="Install commands" className="flex items-center">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "relative px-3 py-2.5 text-xs font-medium transition-colors",
                tab.id === active.id
                  ? "text-fd-foreground"
                  : "text-fd-muted-foreground hover:text-fd-foreground",
              )}
            >
              {tab.label}
              {tab.id === active.id ? (
                <span className="absolute inset-x-2 -bottom-px h-px bg-fd-foreground" />
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyCommands}
          aria-label={copied ? "Copied" : "Copy command"}
          className="me-2 inline-flex size-7 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-secondary/60 hover:text-fd-foreground"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>

      <div className="px-4 py-4 font-mono text-xs leading-relaxed">
        {active.commands.map((command, index) => (
          <p key={command} className="flex gap-2 wrap-anywhere">
            <span aria-hidden className="text-fd-muted-foreground/60 select-none">
              $
            </span>
            <span className="text-fd-foreground">
              {command}
              {index === active.commands.length - 1 ? (
                <span
                  aria-hidden
                  className="ml-1 inline-block h-[13px] w-[7px] translate-y-[2px] bg-fd-foreground/70 motion-safe:animate-pulse"
                />
              ) : null}
            </span>
          </p>
        ))}
        <dl className="mt-3 grid gap-1 border-t border-fd-border pt-3 text-fd-muted-foreground">
          {active.output.map((line) => (
            <div key={line.label} className="flex flex-wrap gap-x-3">
              <dt className="w-16 shrink-0 text-fd-muted-foreground/70">{line.label}</dt>
              <dd className="min-w-0 wrap-anywhere">{line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
