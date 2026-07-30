/**
 * Store panel — one list grouped by facet (console §9.5).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  deleteConfirmation,
  editConfirmation,
  explainCache,
  formatWillNotFire,
  groupByFacet,
  openChild,
  openStore,
  previewOffer,
  purgeConfirmation,
  serializeStoreSearch,
  validateTypedConfirm,
  type StoreListResponse,
  type StoreRecord,
  type StoreSearch,
} from "../../../store/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button } from "../../components/ui.tsx";
import { displayLabel } from "../../../display.ts";

/**
 * Store panel. Tenant lives in the header when tenancy is declared.
 */
export function StorePanel() {
  const search = useSearch({ from: "/store" }) as StoreSearch;
  const navigate = useNavigate({ from: "/store" });
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [patchJson, setPatchJson] = useState("{}");
  const [sqlText, setSqlText] = useState('SELECT * FROM "bookings" LIMIT 50');
  const [probeVector, setProbeVector] = useState("0.1,0.2,0.3");
  const [willNotPreview, setWillNotPreview] = useState<string[] | null>(null);

  const setSearch = (next: StoreSearch) => {
    void navigate({
      search: serializeStoreSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.store.list"],
    queryFn: async () => {
      const res = await consoleCalls.storeList();
      if (res.error) throw new Error(res.error.code);
      return res.data as StoreListResponse;
    },
    refetchInterval: 10_000,
  });

  const tenancyDeclared = listQuery.data?.tenancyDeclared ?? false;
  const tenants = listQuery.data?.tenants ?? [];
  const stores = listQuery.data?.stores ?? [];
  const groups = useMemo(() => groupByFacet(stores, search.q ?? ""), [stores, search.q]);
  const open = stores.find((s) => s.ref === search.ref);
  const child = open?.children.find((c) => c.name === search.child) ?? open?.children[0];
  const view = search.view ?? "browse";
  const editConfirm = editConfirmation({ production: true });
  const delConfirm = deleteConfirmation({ production: true });
  const purgeConfirm = purgeConfirmation({ production: true });
  const dryOffer = open ? previewOffer(open) : null;
  const willNot = child ? formatWillNotFire(child.willNotFire) : null;
  const cache = child ? explainCache(child) : null;

  const browseQuery = useQuery({
    queryKey: [
      "console.store.query",
      search.ref,
      child?.name,
      search.tenant,
      search.prefix,
      view,
      probeVector,
    ],
    enabled: !!open && !!child && view === "browse" && (!tenancyDeclared || !!search.tenant),
    queryFn: async () => {
      if (!open || !child) return null;
      const vector =
        open.facet === "index"
          ? probeVector
              .split(",")
              .map((n) => Number(n.trim()))
              .filter((n) => !Number.isNaN(n))
          : undefined;
      const res = await consoleCalls.storeQuery({
        ref: open.ref,
        child: child.name,
        tenant: search.tenant,
        prefix: search.prefix,
        vector,
        topK: 5,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
  });

  useEffect(() => {
    setTyped("");
    setReason("");
    setWillNotPreview(null);
  }, [open?.ref, child?.name]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["console.store.list"] });
    void qc.invalidateQueries({ queryKey: ["console.store.query"] });
  };

  const previewEdit = useMutation({
    mutationFn: async () => {
      if (!open || !child) return;
      if (dryOffer && !dryOffer.ok) throw new Error(dryOffer.reason);
      let patch: Record<string, unknown> = {};
      try {
        patch = JSON.parse(patchJson) as Record<string, unknown>;
      } catch {
        throw new Error("Patch must be valid JSON");
      }
      const res = await consoleCalls.storePreview({
        ref: open.ref,
        child: child.name,
        tenant: search.tenant,
        id: String(patch.id ?? "preview"),
        key: typeof patch.key === "string" ? patch.key : undefined,
        patch,
      });
      if (res.error) throw new Error(res.error.code);
      const data = res.data!;
      setWillNotPreview(formatWillNotFire(data.willNotFire).lines as string[]);
      return data;
    },
  });

  const commitEdit = useMutation({
    mutationFn: async () => {
      if (!open || !child) return;
      if (editConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: editConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason);
      }
      let patch: Record<string, unknown> = {};
      try {
        patch = JSON.parse(patchJson) as Record<string, unknown>;
      } catch {
        throw new Error("Patch must be valid JSON");
      }
      const res = await consoleCalls.storeEdit({
        ref: open.ref,
        child: child.name,
        tenant: search.tenant,
        id: String(patch.id ?? ""),
        key: typeof patch.key === "string" ? patch.key : undefined,
        patch,
        confirmation: typed,
        reason,
        commit: true,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!open || !child) return;
      if (delConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: delConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason);
      }
      const res = await consoleCalls.storeDelete({
        ref: open.ref,
        child: child.name,
        tenant: search.tenant,
        ids: open.facet === "sql" || open.facet === "index" ? ids : undefined,
        keys: open.facet === "kv" || open.facet === "files" ? ids : undefined,
        confirmation: typed,
        reason,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: invalidate,
  });

  const purgeMut = useMutation({
    mutationFn: async () => {
      if (!child) return;
      if (purgeConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: purgeConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason);
      }
      const res = await consoleCalls.storePurgeCache({
        resource: child.effectRef,
        confirmation: typed,
        reason,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: invalidate,
  });

  const sqlMut = useMutation({
    mutationFn: async () => {
      if (!open || open.facet !== "sql") return;
      const res = await consoleCalls.storeSql({
        ref: open.ref,
        sql: sqlText,
        tenant: search.tenant,
        allowWrite: false,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
  });

  const revealMut = useMutation({
    mutationFn: async (args: { id: string; column: string }) => {
      if (!open || !child) return;
      const res = await consoleCalls.storeReveal({
        ref: open.ref,
        child: child.name,
        tenant: search.tenant,
        id: args.id,
        column: args.column,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-3 border-b border-[var(--oke-line)] px-4 py-3">
        <div className="mr-auto">
          <h1 className="text-lg font-medium">Store</h1>
          <p className="text-sm text-[var(--oke-muted)]">
            One list, grouped by facet — direct edits are not flow executions
          </p>
        </div>
        {tenancyDeclared ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--oke-muted)]">Tenant</span>
            <select
              aria-label="Tenant"
              className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
              value={search.tenant ?? ""}
              onChange={(e) =>
                setSearch({
                  ...search,
                  tenant: e.target.value || undefined,
                })
              }
            >
              <option value="">Select tenant…</option>
              {tenants.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter</span>
          <input
            aria-label="Filter stores"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.target.value || undefined })}
          />
        </label>
      </header>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Store list"
          className="w-72 shrink-0 overflow-y-auto border-r border-[var(--oke-line)]"
        >
          {listQuery.isLoading ? (
            <p className="p-3 text-sm text-[var(--oke-muted)]">Loading…</p>
          ) : null}
          {groups.map((group) => (
            <div key={group.facet} className="border-b border-[var(--oke-line)]">
              <h2 className="px-3 py-2 text-xs tracking-wide text-[var(--oke-muted)]">
                {group.label}
              </h2>
              <ul>
                {group.stores.map((s) => (
                  <li key={s.ref}>
                    <button
                      type="button"
                      aria-pressed={s.ref === search.ref}
                      className={clsx(
                        "flex min-h-8 w-full flex-col items-start px-3 py-2 text-left text-sm",
                        s.ref === search.ref
                          ? "bg-[var(--oke-line)]/40"
                          : "hover:bg-[var(--oke-line)]/20",
                      )}
                      onClick={() => setSearch(openStore(search, s.ref))}
                    >
                      <span>{displayLabel(s.name, s.description)}</span>
                      {s.description ? (
                        <span className="font-mono text-xs text-[var(--oke-muted)]">{s.name}</span>
                      ) : null}
                      <span className="text-xs text-[var(--oke-muted)]">
                        {s.children.length} resource(s)
                        {s.replicaLagMs != null ? ` · lag ${s.replicaLagMs}ms` : ""}
                        {s.migrationDrift?.drifted ? " · drift" : ""}
                        {s.warnings.length > 0 ? ` · ${s.warnings.length} warn` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section
          aria-label="Store detail"
          className="min-w-0 flex-1 overflow-y-auto p-4"
          aria-live="polite"
        >
          {!open ? (
            <p className="text-sm text-[var(--oke-muted)]">
              Select a store. Tenant selector appears only when tenancy is declared on the Manifest.
            </p>
          ) : tenancyDeclared && !search.tenant ? (
            <p role="status" className="text-sm">
              Select a tenant in the header before browsing — compliance boundary, not a display
              filter.
            </p>
          ) : (
            <StoreDetail
              open={open}
              childName={child?.name}
              view={view}
              search={search}
              setSearch={setSearch}
              browse={browseQuery.data}
              browseLoading={browseQuery.isLoading}
              cache={cache}
              willNot={willNot}
              willNotPreview={willNotPreview}
              patchJson={patchJson}
              setPatchJson={setPatchJson}
              typed={typed}
              setTyped={setTyped}
              reason={reason}
              setReason={setReason}
              sqlText={sqlText}
              setSqlText={setSqlText}
              probeVector={probeVector}
              setProbeVector={setProbeVector}
              onPreview={() => previewEdit.mutate()}
              onCommit={() => commitEdit.mutate()}
              onDelete={(ids) => deleteMut.mutate(ids)}
              onPurge={() => purgeMut.mutate()}
              onSql={() => sqlMut.mutate()}
              sqlResult={sqlMut.data}
              onReveal={(id, column) => revealMut.mutate({ id, column })}
              revealValue={revealMut.data?.value}
              error={
                previewEdit.error?.message ??
                commitEdit.error?.message ??
                deleteMut.error?.message ??
                purgeMut.error?.message ??
                sqlMut.error?.message ??
                revealMut.error?.message
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

function StoreDetail(props: {
  readonly open: StoreRecord;
  readonly childName: string | undefined;
  readonly view: "browse" | "cache" | "sql" | "probe";
  readonly search: StoreSearch;
  readonly setSearch: (s: StoreSearch) => void;
  readonly browse: Awaited<ReturnType<typeof consoleCalls.storeQuery>>["data"];
  readonly browseLoading: boolean;
  readonly cache: ReturnType<typeof explainCache> | null;
  readonly willNot: ReturnType<typeof formatWillNotFire> | null;
  readonly willNotPreview: string[] | null;
  readonly patchJson: string;
  readonly setPatchJson: (v: string) => void;
  readonly typed: string;
  readonly setTyped: (v: string) => void;
  readonly reason: string;
  readonly setReason: (v: string) => void;
  readonly sqlText: string;
  readonly setSqlText: (v: string) => void;
  readonly probeVector: string;
  readonly setProbeVector: (v: string) => void;
  readonly onPreview: () => void;
  readonly onCommit: () => void;
  readonly onDelete: (ids: string[]) => void;
  readonly onPurge: () => void;
  readonly onSql: () => void;
  readonly sqlResult:
    | {
        rows: Array<Record<string, unknown>>;
        masked: boolean;
        routedRole: "primary" | "replica";
      }
    | null
    | undefined;
  readonly onReveal: (id: string, column: string) => void;
  readonly revealValue: unknown;
  readonly error?: string;
}) {
  const {
    open,
    childName,
    view,
    search,
    setSearch,
    browse,
    browseLoading,
    cache,
    willNot,
    willNotPreview,
    patchJson,
    setPatchJson,
    typed,
    setTyped,
    reason,
    setReason,
    sqlText,
    setSqlText,
    probeVector,
    setProbeVector,
    onPreview,
    onCommit,
    onDelete,
    onPurge,
    onSql,
    sqlResult,
    onReveal,
    revealValue,
    error,
  } = props;
  const child = open.children.find((c) => c.name === childName);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-medium">{displayLabel(open.name, open.description)}</h2>
        <span className="text-sm text-[var(--oke-muted)]">
          {open.description ? `${open.name} · ` : ""}
          {open.ref}
        </span>
        {open.contentAddressed ? (
          <span role="status" className="text-xs text-[var(--oke-muted)]">
            content-addressed keys
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Views">
        {(
          [
            ["browse", "Browse"],
            ["cache", "Cache"],
            ...(open.facet === "sql" ? ([["sql", "SQL"]] as const) : []),
            ...(open.facet === "index" ? ([["probe", "Probe"]] as const) : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={clsx(
              "min-h-8 px-2 text-sm",
              view === id ? "text-[var(--oke-fg)] underline" : "text-[var(--oke-muted)]",
            )}
            onClick={() => setSearch({ ...search, view: id })}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--oke-muted)]">Resource</span>
        <select
          aria-label="Store resource"
          className="min-h-8 max-w-xs border border-[var(--oke-line)] bg-transparent px-2"
          value={childName ?? ""}
          onChange={(e) => setSearch(openChild(search, e.target.value))}
        >
          {open.children.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {child ? (
        <p className="text-sm" role="status">
          Writers:{" "}
          {child.writers.map((f) => (
            <Link key={f} to="/flows" search={{ flow: f } as never} className="mr-2 underline">
              {f}
            </Link>
          ))}
          {child.writers.length === 0 ? "none" : null}
          {" · "}
          Readers: {child.readers.join(", ") || "none"}
          {child.piiColumns.length > 0 ? ` · PII columns: ${child.piiColumns.join(", ")}` : ""}
        </p>
      ) : null}

      {open.migrationDrift ? (
        <p className="text-sm" role="status">
          Migration: declared {open.migrationDrift.declared.slice(0, 12)}…
          {open.migrationDrift.applied
            ? ` / applied ${open.migrationDrift.applied.slice(0, 12)}…`
            : " / applied (none)"}
          {open.migrationDrift.drifted ? " — drifted" : " — in sync"}
        </p>
      ) : null}

      {open.warnings.length > 0 ? (
        <ul aria-label="Operational warnings" className="text-sm">
          {open.warnings.map((w) => (
            <li key={`${w.key}:${w.code}`} role="status">
              {w.key}: {w.message}
            </li>
          ))}
        </ul>
      ) : null}

      {view === "cache" && cache ? (
        <section aria-label="Cache">
          <h3 className="text-sm font-medium">Cache</h3>
          <p className="text-sm" role="status">
            {cache.summary}
          </p>
          <p className="text-xs text-[var(--oke-muted)]">
            Invalidating flows: {cache.invalidatingFlows.join(", ") || "none"}
          </p>
          <Button type="button" onClick={onPurge}>
            Purge cache namespace
          </Button>
        </section>
      ) : null}

      {view === "sql" && open.facet === "sql" ? (
        <section aria-label="SQL console" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">SQL console (read-only)</h3>
          <textarea
            aria-label="SQL console"
            className="min-h-24 border border-[var(--oke-line)] bg-transparent p-2 font-mono text-sm"
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
          />
          <Button type="button" onClick={onSql}>
            Run
          </Button>
          {sqlResult ? (
            <p className="text-xs text-[var(--oke-muted)]">
              {sqlResult.rows.length} row(s) · routed {sqlResult.routedRole}
              {sqlResult.masked ? " · PII masked" : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {(view === "browse" || view === "probe") && (
        <section aria-label="Browse">
          {open.facet === "index" ? (
            <label className="mb-2 flex flex-col gap-1 text-sm">
              <span>Probe vector</span>
              <input
                aria-label="Probe vector"
                className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2 font-mono"
                value={probeVector}
                onChange={(e) => setProbeVector(e.target.value)}
              />
            </label>
          ) : null}
          {browseLoading ? <p className="text-sm text-[var(--oke-muted)]">Loading…</p> : null}
          {browse?.rows ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {Object.keys(browse.rows[0] ?? { id: 1 }).map((col) => (
                    <th key={col} scope="col" className="border-b px-2 py-1">
                      {displayLabel(col, child?.columnDescriptions[col])}
                    </th>
                  ))}
                  <th scope="col" className="border-b px-2 py-1">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {browse.rows.map((row, i) => (
                  <tr key={i}>
                    {Object.entries(row).map(([col, val]) => (
                      <td key={col} className="border-b px-2 py-1 font-mono">
                        {String(val)}
                        {child?.piiColumns.includes(col) ? (
                          <button
                            type="button"
                            className="ml-2 underline"
                            style={{ minHeight: 32 }}
                            onClick={() => onReveal(String(row.id ?? ""), col)}
                          >
                            Reveal
                          </button>
                        ) : null}
                      </td>
                    ))}
                    <td className="border-b px-2 py-1">
                      <Button type="button" onClick={() => onDelete([String(row.id ?? "")])}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {browse?.keys ? (
            <ul aria-label="Keys" className="text-sm">
              {browse.keys.map((k) => (
                <li key={k.key} className="flex min-h-8 items-center gap-2">
                  <span className="font-mono">{k.key}</span>
                  {k.value !== undefined ? (
                    <span className="text-[var(--oke-muted)]">{JSON.stringify(k.value)}</span>
                  ) : null}
                  {k.warnings?.map((w) => (
                    <span key={w.code} role="status" className="text-xs">
                      {w.message}
                    </span>
                  ))}
                  <Button type="button" onClick={() => onDelete([k.key])}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {browse?.hits ? (
            <ul aria-label="Similarity hits" className="text-sm">
              {browse.hits.map((h) => (
                <li key={h.id}>
                  {h.id} · score {h.score.toFixed(3)}
                </li>
              ))}
            </ul>
          ) : null}
          {revealValue !== undefined ? (
            <p role="status" className="text-sm">
              Revealed: {String(revealValue)}
            </p>
          ) : null}
        </section>
      )}

      <section
        aria-label="Direct edit"
        className="flex flex-col gap-2 border-t border-[var(--oke-line)] pt-4"
      >
        <h3 className="text-sm font-medium">Direct edit</h3>
        <p className="text-sm text-[var(--oke-muted)]">
          Not a flow execution. Before saving, preview names what will not fire.
        </p>
        {willNot && !willNot.empty ? (
          <ul className="text-sm">
            {(willNotPreview ?? willNot.lines).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--oke-muted)]">
            No owning-flow emissions declared for this resource.
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Patch (JSON)
          <textarea
            aria-label="Edit patch JSON"
            className="min-h-20 border border-[var(--oke-line)] bg-transparent p-2 font-mono text-sm"
            value={patchJson}
            onChange={(e) => setPatchJson(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type EDIT / DELETE / PURGE
          <input
            aria-label="Confirmation phrase"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Reason
          <input
            aria-label="Confirmation reason"
            className="min-h-8 border border-[var(--oke-line)] bg-transparent px-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onPreview}>
            Preview
          </Button>
          <Button type="button" onClick={onCommit}>
            Save edit
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
