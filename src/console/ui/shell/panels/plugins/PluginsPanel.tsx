/**
 * Plugins panel — origin × state, declares/intercepts, supply-chain,
 * capability diff, copyable command only (console §9.15).
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import {
  copyCommandLabel,
  copyableCommand,
  groupPlugins,
  openPlugin,
  serializePluginsSearch,
  type PluginOrigin,
  type PluginRecord,
  type PluginState,
  type PluginsListResponse,
  type PluginsSearch,
} from "../../../plugins/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Input } from "../../components/ui.tsx";
import { displayLabel } from "../../../display.ts";

/**
 * Plugins panel — read-only catalogue + supply-chain surface.
 */
export function PluginsPanel() {
  const search = useSearch({ from: "/plugins" }) as PluginsSearch;
  const navigate = useNavigate({ from: "/plugins" });
  const [copied, setCopied] = useState<string | null>(null);

  const setSearch = (next: PluginsSearch) => {
    void navigate({
      search: serializePluginsSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.plugin.list"],
    queryFn: async () => {
      const res = await consoleCalls.pluginsList();
      if (res.error) throw new Error(res.error.code);
      return res.data as PluginsListResponse;
    },
    refetchInterval: 15_000,
  });

  const list = listQuery.data;
  const groups = useMemo(() => groupPlugins(list?.plugins ?? [], search), [list?.plugins, search]);
  const open = list?.plugins.find((p) => p.id === search.plugin) ?? list?.plugins[0] ?? null;
  const command = open ? copyableCommand(open) : null;

  const copy = async () => {
    if (!command) return;
    await navigator.clipboard.writeText(command);
    setCopied(command);
    window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--oke-line)] px-4 py-3">
        <h1 className="text-lg text-[var(--oke-fg)]">Plugins</h1>
        <p className="mt-1 text-sm text-[var(--oke-muted)]">
          Origin × state — CORE stays listed when off; local/community only when plugged. Read-only;
          git review is the approval.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--oke-muted)]">
            Filter
            <Input
              aria-label="Filter plugins"
              value={search.q ?? ""}
              onChange={(e) => setSearch({ ...search, q: e.target.value || undefined })}
              className="min-h-8 w-56"
            />
          </label>
          <OriginFilter
            value={search.origin}
            onChange={(origin) => setSearch({ ...search, origin })}
          />
          <StateFilter value={search.state} onChange={(state) => setSearch({ ...search, state })} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Plugins by origin"
          className="w-80 shrink-0 overflow-y-auto border-r border-[var(--oke-line)]"
        >
          {listQuery.isLoading ? (
            <p className="p-4 text-sm text-[var(--oke-muted)]">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="p-4 text-sm text-[var(--oke-muted)]">No plugins</p>
          ) : (
            groups.map((g) => (
              <div key={g.id} className="border-b border-[var(--oke-line)]">
                <h2 className="px-3 py-2 text-xs tracking-wide text-[var(--oke-muted)] uppercase">
                  {g.label}
                </h2>
                <ul>
                  {g.items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={open?.id === p.id}
                        className={clsx(
                          "flex min-h-8 w-full items-center gap-2 px-3 py-2 text-left text-sm",
                          open?.id === p.id
                            ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
                            : "text-[var(--oke-muted)] hover:text-[var(--oke-fg)]",
                        )}
                        onClick={() => setSearch(openPlugin(search, p.id))}
                      >
                        <span className="font-mono">{p.id}</span>
                        <span className="ml-auto text-xs">{p.state}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>

        <section
          aria-label="Plugin detail"
          aria-live="polite"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {!open ? (
            <p className="text-sm text-[var(--oke-muted)]">Select a plugin</p>
          ) : (
            <PluginDetail
              plugin={open}
              command={command}
              copied={copied}
              onCopy={() => void copy()}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function PluginDetail(props: {
  readonly plugin: PluginRecord;
  readonly command: string | null;
  readonly copied: string | null;
  readonly onCopy: () => void;
}) {
  const { plugin: p, command, copied, onCopy } = props;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-base text-[var(--oke-fg)]">
          <span className="font-mono">{p.id}</span>{" "}
          <span className="text-sm text-[var(--oke-muted)]">
            ({p.origin} · {p.state})
          </span>
        </h2>
        {p.summary ? <p className="mt-1 text-sm text-[var(--oke-muted)]">{p.summary}</p> : null}
        {p.version ? (
          <p className="mt-1 text-xs text-[var(--oke-muted)]">Version {p.version}</p>
        ) : null}
      </div>

      <section aria-label="Declares">
        <h3 className="text-sm text-[var(--oke-fg)]">Declares</h3>
        <p className="text-xs text-[var(--oke-muted)]">
          Boot-time — schema, elements, drivers, panels, CLI
        </p>
        {p.declares.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--oke-muted)]">None</p>
        ) : (
          <ul className="mt-2 list-inside list-disc text-sm">
            {p.declares.map((d) => {
              const tableName = d.startsWith("table:") ? d.slice("table:".length) : null;
              const description = tableName ? p.tables[tableName]?.description : undefined;
              return (
                <li key={d}>
                  {tableName && description ? (
                    <>
                      <span>{displayLabel(tableName, description)}</span>
                      <code className="ml-2 font-mono text-[var(--oke-muted)]">{d}</code>
                    </>
                  ) : (
                    <code className="font-mono">{d}</code>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Intercepts">
        <h3 className="text-sm text-[var(--oke-fg)]">Intercepts</h3>
        <p className="text-xs text-[var(--oke-muted)]">
          Per-request hooks — measured in the kernel pipeline
        </p>
        {p.intercepts.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--oke-muted)]">None</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <caption className="sr-only">Hook stages and measured mean cost</caption>
            <thead>
              <tr className="text-xs text-[var(--oke-muted)]">
                <th scope="col" className="py-1 pr-3 font-normal">
                  Stage
                </th>
                <th scope="col" className="py-1 pr-3 font-normal">
                  Mean ms
                </th>
                <th scope="col" className="py-1 font-normal">
                  Samples
                </th>
              </tr>
            </thead>
            <tbody>
              {p.intercepts.map((i) => (
                <tr key={i.stage} className="border-t border-[var(--oke-line)]">
                  <th scope="row" className="py-1 pr-3 font-mono font-normal">
                    {i.stage}
                  </th>
                  <td className="py-1 pr-3">{i.meanMs === null ? "—" : i.meanMs.toFixed(2)}</td>
                  <td className="py-1">{i.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {p.hookCost ? (
          <p className="mt-2 text-xs text-[var(--oke-muted)]" role="status">
            p50 {p.hookCost.p50Ms.toFixed(2)} ms · p95 {p.hookCost.p95Ms.toFixed(2)} ms · n=
            {p.hookCost.count}
          </p>
        ) : null}
      </section>

      <section aria-label="Supply chain">
        <h3 className="text-sm text-[var(--oke-fg)]">Supply chain</h3>
        <ul className="mt-2 space-y-1 text-sm">
          <SignalLine
            label="Lifecycle scripts"
            state={p.supplyChain.lifecycleScripts.state}
            detail={p.supplyChain.lifecycleScripts.detail}
          />
          <SignalLine
            label="Release cooldown"
            state={p.supplyChain.releaseCooldown.state}
            detail={p.supplyChain.releaseCooldown.detail}
          />
          <SignalLine
            label="node: scan"
            state={p.supplyChain.nodeImportScan.state}
            detail={p.supplyChain.nodeImportScan.detail}
          />
          <SignalLine
            label="npm provenance"
            state={p.supplyChain.npmProvenance.state}
            detail={p.supplyChain.npmProvenance.detail}
          />
          <SignalLine
            label="Boot conflicts"
            state={p.supplyChain.bootConflicts.state}
            detail={p.supplyChain.bootConflicts.detail}
          />
        </ul>
      </section>

      <section aria-label="Capability diff">
        <h3 className="text-sm text-[var(--oke-fg)]">Capability diff</h3>
        <p className="text-xs text-[var(--oke-muted)]">
          Git merge-base via diffManifest (oke doctor --diff) — not recomputed
        </p>
        {p.capabilityDiff.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--oke-muted)]">
            No pending capability changes for this plugin
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {p.capabilityDiff.map((c) => (
              <li key={c.path}>
                <a
                  className="text-[var(--oke-fg)] underline"
                  href={`/manifest-diff?path=${encodeURIComponent(c.path)}`}
                >
                  {c.summary}
                </a>
                <span className="ml-2 text-xs text-[var(--oke-muted)]">{c.category}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Install command">
        <h3 className="text-sm text-[var(--oke-fg)]">Command</h3>
        {command ? (
          <div className="mt-2 flex flex-col gap-2">
            <pre className="overflow-x-auto rounded border border-[var(--oke-line)] bg-[var(--oke-bg)] p-3 font-mono text-sm">
              <code>{command}</code>
            </pre>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={onCopy} className="min-h-8">
                {copyCommandLabel(p)}
              </Button>
              {copied ? (
                <span className="text-xs text-[var(--oke-muted)]" role="status">
                  Copied
                </span>
              ) : null}
            </div>
            <p className="text-xs text-[var(--oke-muted)]">
              The Console never installs. Git review is the approval — run this yourself.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--oke-muted)]">
            No install command — turn off by removing the code line, not from this UI.
          </p>
        )}
      </section>
    </div>
  );
}

function SignalLine(props: {
  readonly label: string;
  readonly state: string;
  readonly detail: string;
}) {
  return (
    <li>
      <span className="text-[var(--oke-muted)]">{props.label}:</span>{" "}
      <span className="font-mono text-xs">{props.state}</span>
      <span className="text-[var(--oke-muted)]"> — {props.detail}</span>
    </li>
  );
}

function OriginFilter(props: {
  readonly value: PluginOrigin | undefined;
  readonly onChange: (v: PluginOrigin | undefined) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-xs">
      <legend className="sr-only">Origin</legend>
      {(
        [
          [undefined, "All origins"],
          ["core", "Core"],
          ["local", "Local"],
          ["community", "Community"],
        ] as const
      ).map(([v, label]) => (
        <label key={label} className="inline-flex min-h-8 items-center gap-1">
          <input
            type="radio"
            name="plugins-origin"
            checked={props.value === v}
            onChange={() => props.onChange(v)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function StateFilter(props: {
  readonly value: PluginState | undefined;
  readonly onChange: (v: PluginState | undefined) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 text-xs">
      <legend className="sr-only">State</legend>
      {(
        [
          [undefined, "All states"],
          ["on", "On"],
          ["off", "Off"],
        ] as const
      ).map(([v, label]) => (
        <label key={label} className="inline-flex min-h-8 items-center gap-1">
          <input
            type="radio"
            name="plugins-state"
            checked={props.value === v}
            onChange={() => props.onChange(v)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
