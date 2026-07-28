/**
 * Vault panel — fingerprints, resolution, readers, blast radius (console §9.8).
 *
 * Secrets are write-only. There is no preview affordance.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  exportSafeList,
  formatBlastRadius,
  groupByKind,
  openVault,
  rotateConfirmation,
  serializeVaultSearch,
  setConfirmation,
  validateTypedConfirm,
  type VaultListResponse,
  type VaultSearch,
} from "../../../vault/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Input } from "../../components/ui.tsx";

/**
 * Vault panel. Set / rotate are real writes — no dry-run.
 */
export function VaultPanel() {
  const search = useSearch({ from: "/vault" }) as VaultSearch;
  const navigate = useNavigate({ from: "/vault" });
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [exportNote, setExportNote] = useState<string | null>(null);

  const setSearch = (next: VaultSearch) => {
    void navigate({
      search: serializeVaultSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.vault.list"],
    queryFn: async () => {
      const res = await consoleCalls.vaultList();
      if (res.error) throw new Error(res.error.code);
      return res.data as VaultListResponse;
    },
    refetchInterval: 10_000,
  });

  const secrets = listQuery.data?.secrets ?? [];
  const env = listQuery.data?.env ?? "local";
  const groups = useMemo(() => groupByKind(secrets, search.q ?? ""), [secrets, search.q]);
  const open = secrets.find((s) => s.name === search.name);
  const blast = open ? formatBlastRadius(open.blastRadius) : null;
  const setConfirm = setConfirmation({ production: true });
  const rotateConfirm = rotateConfirmation({ production: true });
  const action = search.action;

  useEffect(() => {
    setTyped("");
    setReason("");
    setValue("");
    setExportNote(null);
  }, [open?.name, action]);

  const setMut = useMutation({
    mutationFn: async () => {
      if (!open) throw new Error("no secret");
      if (setConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: setConfirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      }
      const res = await consoleCalls.vaultSet({
        name: open.name,
        value,
        confirmation: setConfirm.kind === "typed" ? typed : undefined,
        reason: reason || undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: async () => {
      setValue("");
      setTyped("");
      setReason("");
      setSearch({ ...search, action: undefined });
      await qc.invalidateQueries({ queryKey: ["console.vault.list"] });
    },
  });

  const rotateMut = useMutation({
    mutationFn: async () => {
      if (!open) throw new Error("no secret");
      const errors = validateTypedConfirm({
        typed,
        reason,
        phrase: rotateConfirm.kind === "typed" ? rotateConfirm.phrase : "ROTATE",
      });
      if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      const res = await consoleCalls.vaultRotate({
        name: open.name,
        value,
        confirmation: typed,
        reason,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: async () => {
      setValue("");
      setTyped("");
      setReason("");
      setSearch({ ...search, action: undefined });
      await qc.invalidateQueries({ queryKey: ["console.vault.list"] });
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-3 border-b border-[var(--oke-line)] px-4 py-3">
        <div>
          <h1 className="text-lg font-medium text-[var(--oke-fg)]">Vault</h1>
          <p className="text-sm text-[var(--oke-muted)]">
            Fingerprints only — secrets are write-only
          </p>
        </div>
        <p className="text-sm text-[var(--oke-muted)]" role="status">
          Environment {env}
        </p>
        <label className="ml-auto flex min-w-[12rem] flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter vault</span>
          <Input
            aria-label="Filter vault"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.currentTarget.value || undefined })}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const payload = exportSafeList(secrets);
            void navigator.clipboard?.writeText(payload);
            setExportNote("Exported fingerprints only (no secret values)");
          }}
        >
          Export
        </Button>
      </header>

      {exportNote ? (
        <p className="px-4 py-2 text-sm text-[var(--oke-muted)]" role="status">
          {exportNote}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Vault list"
          className="w-80 shrink-0 overflow-y-auto border-r border-[var(--oke-line)]"
        >
          <h2 className="sr-only">Contracts</h2>
          {listQuery.isLoading ? (
            <p className="p-4 text-sm text-[var(--oke-muted)]">Loading…</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.kind} aria-label={group.label} className="py-2">
              <h3 className="px-4 py-1 text-xs uppercase tracking-wide text-[var(--oke-muted)]">
                {group.label}
              </h3>
              <ul>
                {group.secrets.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      aria-pressed={s.name === open?.name}
                      className={clsx(
                        "flex min-h-10 w-full flex-col items-start px-4 py-2 text-left text-sm",
                        s.name === open?.name
                          ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
                          : "text-[var(--oke-muted)] hover:text-[var(--oke-fg)]",
                      )}
                      onClick={() => setSearch(openVault(search, s.name))}
                    >
                      <span className="font-mono">{s.name}</span>
                      <span className="truncate text-xs">
                        {s.sensitive ? (s.fingerprint ?? "unset") : (s.cleartext ?? "unset")}
                      </span>
                      {s.blastRadius.count > 0 ? (
                        <span role="status" className="text-xs text-[var(--oke-danger)]">
                          blast {s.blastRadius.count}
                        </span>
                      ) : null}
                      {s.sharedFingerprintEnvs.length > 0 ? (
                        <span role="status" className="text-xs">
                          shared fingerprint
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        <section
          aria-label="Vault detail"
          aria-live="polite"
          className="min-w-0 flex-1 overflow-y-auto p-4"
        >
          {!open ? (
            <p className="text-sm text-[var(--oke-muted)]">
              Select a contract to inspect fingerprints, resolution, and readers.
            </p>
          ) : (
            <div className="flex max-w-2xl flex-col gap-6">
              <div>
                <h2 className="font-mono text-lg text-[var(--oke-fg)]">{open.name}</h2>
                {open.description ? (
                  <p className="text-sm text-[var(--oke-muted)]">{open.description}</p>
                ) : null}
                {open.rotate ? (
                  <p className="text-sm text-[var(--oke-muted)]">Rotate hint: {open.rotate}</p>
                ) : null}
              </div>

              <section aria-label="Fingerprints by environment">
                <h3 className="mb-2 text-sm font-medium">Fingerprints</h3>
                {open.sensitive ? (
                  <ul className="space-y-1 font-mono text-sm">
                    {Object.entries(open.fingerprints).map(([e, fp]) => (
                      <li key={e}>
                        <span className="text-[var(--oke-muted)]">{e}:</span> {fp}
                        {open.sharedFingerprintEnvs.includes(e) ? (
                          <span
                            role="status"
                            className="ml-2 text-[var(--oke-warn,var(--oke-muted))]"
                          >
                            (matches {env} — warning, may be deliberate)
                          </span>
                        ) : null}
                      </li>
                    ))}
                    {Object.keys(open.fingerprints).length === 0 ? (
                      <li className="text-[var(--oke-muted)]">Unset</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="font-mono text-sm" role="status">
                    {open.cleartext ?? "unset"}
                  </p>
                )}
              </section>

              <section aria-label="Resolution chain">
                <h3 className="mb-2 text-sm font-medium">Resolution chain</h3>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {open.resolution.map((step) => (
                    <li
                      key={step.source}
                      className={step.won ? "text-[var(--oke-fg)]" : "text-[var(--oke-muted)]"}
                    >
                      <span className="font-mono">{step.source}</span>
                      {step.won ? " — won" : step.present ? " — present (lost)" : " — absent"}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-sm" role="status">
                  Winner: <span className="font-mono">{open.winner ?? "none"}</span>
                </p>
              </section>

              <section aria-label="Readers">
                <h3 className="mb-2 text-sm font-medium">Readers</h3>
                <p className="text-sm text-[var(--oke-muted)]">
                  Flows that declare <code className="font-mono">fx.vault({open.name})</code>
                </p>
                <ul className="mt-1 list-disc pl-5 font-mono text-sm">
                  {open.readers.length === 0 ? (
                    <li className="text-[var(--oke-muted)]">none</li>
                  ) : (
                    open.readers.map((r) => <li key={r}>{r}</li>)
                  )}
                </ul>
              </section>

              <section aria-label="Rotation blast radius">
                <h3 className="mb-2 text-sm font-medium">Rotation blast radius</h3>
                {blast ? (
                  <>
                    <p className="text-sm" role={blast.warn ? "alert" : "status"}>
                      {blast.summary}
                    </p>
                    {blast.detail ? (
                      <p className="text-sm text-[var(--oke-muted)]">{blast.detail}</p>
                    ) : null}
                    {open.blastRadius.runIds.length > 0 ? (
                      <p className="mt-1 font-mono text-xs text-[var(--oke-muted)]">
                        {open.blastRadius.runIds.join(", ")}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </section>

              <section aria-label="Last read">
                <h3 className="mb-2 text-sm font-medium">Last read</h3>
                <p className="text-sm" role="status">
                  {open.lastReadAt != null
                    ? new Date(open.lastReadAt).toISOString()
                    : "Never read — possible dead secret"}
                </p>
              </section>

              <section aria-label="Set or rotate" className="space-y-3">
                <h3 className="text-sm font-medium">Set / rotate</h3>
                <p className="text-sm text-[var(--oke-muted)]">
                  Write-only. Values are never revealed after submit. No preview.
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={action === "set" ? "primary" : "ghost"}
                    aria-pressed={action === "set"}
                    onClick={() => setSearch({ ...search, action: "set" })}
                  >
                    Set
                  </Button>
                  <Button
                    type="button"
                    variant={action === "rotate" ? "danger" : "ghost"}
                    aria-pressed={action === "rotate"}
                    onClick={() => setSearch({ ...search, action: "rotate" })}
                  >
                    Rotate
                  </Button>
                </div>

                {action ? (
                  <div className="space-y-3 border border-[var(--oke-line)] p-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span>New value</span>
                      <Input
                        aria-label="New vault value"
                        type="password"
                        autoComplete="off"
                        value={value}
                        onChange={(e) => setValue(e.currentTarget.value)}
                      />
                    </label>
                    {(action === "rotate" || setConfirm.kind === "typed") && (
                      <>
                        <label className="flex flex-col gap-1 text-sm">
                          <span>
                            Type{" "}
                            {action === "rotate"
                              ? rotateConfirm.kind === "typed"
                                ? rotateConfirm.phrase
                                : "ROTATE"
                              : setConfirm.kind === "typed"
                                ? setConfirm.phrase
                                : "SET"}{" "}
                            to confirm
                          </span>
                          <Input
                            aria-label="Confirmation phrase"
                            value={typed}
                            onChange={(e) => setTyped(e.currentTarget.value)}
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-sm">
                          <span>Reason</span>
                          <Input
                            aria-label="Reason for vault write"
                            value={reason}
                            onChange={(e) => setReason(e.currentTarget.value)}
                          />
                        </label>
                      </>
                    )}
                    <Button
                      type="button"
                      variant={action === "rotate" ? "danger" : "primary"}
                      disabled={
                        !value || (action === "set" ? setMut.isPending : rotateMut.isPending)
                      }
                      onClick={() => {
                        if (action === "set") setMut.mutate();
                        else rotateMut.mutate();
                      }}
                    >
                      {action === "set" ? "Commit set" : "Commit rotate"}
                    </Button>
                    {(setMut.isError || rotateMut.isError) && (
                      <p role="alert" className="text-sm text-[var(--oke-danger)]">
                        {(setMut.error ?? rotateMut.error)?.message ?? "Failed"}
                      </p>
                    )}
                  </div>
                ) : null}
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
