/**
 * Overview shell — health strip + audited action + plugin sandbox host.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { consoleCalls } from "../client.ts";
import { Button } from "../components/ui.tsx";
import { PluginSandbox } from "../plugin/Sandbox.tsx";

/**
 * Overview panel.
 */
export function OverviewPanel() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["console.session.me"],
    queryFn: async () => {
      const res = await consoleCalls.sessionMe();
      if (res.error) throw new Error(res.error.code);
      return res.data as { name: string; email: string };
    },
  });
  const runs = useQuery({
    queryKey: ["console.runs.list"],
    queryFn: async () => {
      const res = await consoleCalls.runsList();
      if (res.error) throw new Error(res.error.code);
      return res.data as {
        runs: Array<{ id: string; flow: string; startedAt: number }>;
      };
    },
  });
  const ping = useMutation({
    mutationFn: async () => {
      const res = await consoleCalls.actionPing("overview");
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["console.runs.list"] });
    },
  });

  return (
    <div className="flex flex-col gap-8 px-6 py-8">
      <header className="flex flex-col gap-2 border-b border-[var(--oke-line)] pb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">
          Overview
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">oke Console</h1>
        <p className="text-[var(--oke-muted)]">
          {me.data
            ? `Signed in as ${me.data.name} · ${me.data.email}`
            : "Loading operator…"}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Actions</h2>
        <p className="text-sm text-[var(--oke-muted)]">
          Every action is a real flow through fx — the audit log is the trace.
        </p>
        <div>
          <Button
            type="button"
            onClick={() => ping.mutate()}
            disabled={ping.isPending}
          >
            Ping (audited)
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Recent traces</h2>
        <ul className="divide-y divide-[var(--oke-line)] border-y border-[var(--oke-line)]">
          {(runs.data?.runs ?? []).slice(0, 12).map((r) => (
            <li
              key={r.id}
              className="flex min-h-8 items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="font-mono text-[13px]">{r.flow}</span>
              <span className="text-[var(--oke-muted)]">
                {new Date(r.startedAt).toLocaleTimeString()}
              </span>
            </li>
          ))}
          {(runs.data?.runs.length ?? 0) === 0 ? (
            <li className="py-3 text-sm text-[var(--oke-muted)]">No runs yet.</li>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Plugin panel (sandboxed)</h2>
        <PluginSandbox panelId="overview" title="Overview plugin" />
      </section>
    </div>
  );
}
