/**
 * Access panel — two planes, attenuation by absence, once-shown secrets,
 * revocation blast radius, effective permissions (console §9.14).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import {
  canDismissOnceSecret,
  formatAccessBlastRadius,
  formatProvenance,
  hygieneLines,
  ONCE_SECRET_ACK_LABEL,
  ONCE_SECRET_WARNING,
  openAccessEntity,
  revokeConfirmation,
  rotateConfirmation,
  serializeAccessSearch,
  validateTypedConfirm,
  type AccessBlastRadius,
  type AccessEffectiveResponse,
  type AccessKeyRecord,
  type AccessListResponse,
  type AccessSearch,
  type OnceSecretState,
} from "../../../access/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Input } from "../../components/ui.tsx";

/**
 * Access panel. Plane and selection live in URL search params.
 */
export function AccessPanel() {
  const search = useSearch({ from: "/access" }) as AccessSearch;
  const navigate = useNavigate({ from: "/access" });
  const queryClient = useQueryClient();
  const plane = search.plane ?? "operator";
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [keyName, setKeyName] = useState("");
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [onceSecret, setOnceSecret] = useState<OnceSecretState | null>(null);
  const [blast, setBlast] = useState<AccessBlastRadius | null>(null);
  const [effective, setEffective] = useState<AccessEffectiveResponse | null>(null);

  const setSearch = (next: AccessSearch) => {
    void navigate({
      search: serializeAccessSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.access.list"],
    queryFn: async () => {
      const res = await consoleCalls.accessList();
      if (res.error) throw new Error(res.error.code);
      return res.data as AccessListResponse;
    },
    refetchInterval: 10_000,
  });

  const data = listQuery.data;
  const section = plane === "operator" ? data?.operatorPlane : data?.userPlane;
  const grantable = section?.grantableScopes ?? [];
  const hygiene = data?.hygiene;
  const lines = useMemo(() => (hygiene ? hygieneLines(hygiene) : []), [hygiene]);

  const openKey: AccessKeyRecord | undefined = section?.keys.find(
    (k) => search.kind === "key" && k.id === search.id,
  );
  const openRole = section?.roles.find((r) => search.kind === "role" && r.id === search.id);
  const openOperator = section?.operators?.find(
    (o) => search.kind === "operator" && o.id === search.id,
  );
  const openUser = section?.users?.find((u) => search.kind === "user" && u.id === search.id);

  const q = (search.q ?? "").toLowerCase();
  const filterText = (text: string) => q.length === 0 || text.toLowerCase().includes(q);

  const createKey = useMutation({
    mutationFn: async () => {
      if (!keyName.trim()) throw new Error("Name required");
      const res = await consoleCalls.accessCreateKey({
        plane,
        name: keyName.trim(),
        scopes: selectedScopes,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as { key: AccessKeyRecord; secret: string };
    },
    onSuccess: (result) => {
      setOnceSecret({
        secret: result.secret,
        keyId: result.key.id,
        keyName: result.key.name,
        acknowledged: false,
      });
      setKeyName("");
      setSelectedScopes([]);
      void queryClient.invalidateQueries({ queryKey: ["console.access.list"] });
    },
  });

  const loadBlast = useMutation({
    mutationFn: async (keyId: string) => {
      const res = await consoleCalls.accessKeyBlast({ keyId });
      if (res.error) throw new Error(res.error.code);
      return res.data as AccessBlastRadius;
    },
    onSuccess: setBlast,
  });

  const revokeKey = useMutation({
    mutationFn: async () => {
      if (!openKey) throw new Error("Select a key");
      const confirm = revokeConfirmation();
      if (confirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: confirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      }
      const res = await consoleCalls.accessRevokeKey({
        keyId: openKey.id,
        confirmation: typed,
        reason,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as {
        key: AccessKeyRecord;
        blastRadius: AccessBlastRadius;
      };
    },
    onSuccess: (result) => {
      setBlast(result.blastRadius);
      setTyped("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["console.access.list"] });
    },
  });

  const rotateKey = useMutation({
    mutationFn: async () => {
      if (!openKey) throw new Error("Select a key");
      const confirm = rotateConfirmation();
      if (confirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: confirm.phrase,
        });
        if (errors) throw new Error(errors.typed ?? errors.reason ?? "confirm");
      }
      const res = await consoleCalls.accessRotateKey({
        keyId: openKey.id,
        confirmation: typed,
        reason,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as {
        key: AccessKeyRecord;
        secret: string;
        blastRadius: AccessBlastRadius;
      };
    },
    onSuccess: (result) => {
      setBlast(result.blastRadius);
      setOnceSecret({
        secret: result.secret,
        keyId: result.key.id,
        keyName: result.key.name,
        acknowledged: false,
      });
      setTyped("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["console.access.list"] });
    },
  });

  const loadEffective = useMutation({
    mutationFn: async () => {
      const kind = search.kind === "invite" || !search.kind || !search.id ? null : search.kind;
      if (!kind || !search.id) throw new Error("Select a principal");
      const res = await consoleCalls.accessEffective({
        kind,
        id: search.id,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as AccessEffectiveResponse;
    },
    onSuccess: setEffective,
  });

  const grantRole = useMutation({
    mutationFn: async () => {
      if (!openRole) throw new Error("Select a role");
      const res = await consoleCalls.accessSetRoleGrants({
        roleId: openRole.id,
        scopes: selectedScopes,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["console.access.list"] });
    },
  });

  const blastLines = blast ? formatAccessBlastRadius(blast) : null;
  const provenance = effective ? formatProvenance(effective) : [];

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end gap-3 border-b border-[var(--oke-line)] px-4 py-3">
        <div>
          <h1 className="text-lg font-medium text-[var(--oke-fg)]">Access</h1>
          <p className="text-sm text-[var(--oke-muted)]">
            Identities, roles, API keys — planes never merge
          </p>
        </div>
        <div role="group" aria-label="Plane" className="flex gap-1">
          <Button
            type="button"
            variant={plane === "operator" ? "primary" : "ghost"}
            aria-pressed={plane === "operator"}
            onClick={() =>
              setSearch({
                ...search,
                plane: "operator",
                kind: undefined,
                id: undefined,
                view: undefined,
              })
            }
          >
            Operator plane
          </Button>
          <Button
            type="button"
            variant={plane === "user" ? "primary" : "ghost"}
            aria-pressed={plane === "user"}
            onClick={() =>
              setSearch({
                ...search,
                plane: "user",
                kind: undefined,
                id: undefined,
                view: undefined,
              })
            }
          >
            User plane
          </Button>
        </div>
        <label className="ml-auto flex min-w-[12rem] flex-col gap-1 text-sm">
          <span className="text-[var(--oke-muted)]">Filter access</span>
          <Input
            aria-label="Filter access"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.currentTarget.value || undefined })}
          />
        </label>
      </header>

      {lines.length > 0 ? (
        <section
          aria-label="Access hygiene"
          className="border-b border-[var(--oke-line)] px-4 py-2"
          role="status"
        >
          <h2 className="sr-only">Hygiene</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--oke-warn,var(--oke-muted))]">
            {lines.map((line) => (
              <li key={line.code}>{line.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <section
          aria-label={`${plane} plane list`}
          className="w-80 shrink-0 overflow-y-auto border-r border-[var(--oke-line)]"
        >
          <h2 className="px-4 py-2 text-sm font-medium">
            {plane === "operator" ? "Operator plane" : "User plane"}
          </h2>

          {section?.operators ? (
            <PlaneGroup label="Operators">
              {section.operators
                .filter((o) => filterText(`${o.name} ${o.email}`))
                .map((op) => (
                  <EntityButton
                    key={op.id}
                    selected={search.kind === "operator" && search.id === op.id}
                    onClick={() =>
                      setSearch(openAccessEntity(search, "operator", "operator", op.id))
                    }
                  >
                    {op.name}
                    {op.neverSignedIn ? (
                      <span className="text-[var(--oke-muted)]"> · never</span>
                    ) : null}
                  </EntityButton>
                ))}
            </PlaneGroup>
          ) : null}

          {section?.users ? (
            <PlaneGroup label="Users">
              {section.users
                .filter((u) => filterText(`${u.name} ${u.email}`))
                .map((u) => (
                  <EntityButton
                    key={u.id}
                    selected={search.kind === "user" && search.id === u.id}
                    onClick={() => setSearch(openAccessEntity(search, "user", "user", u.id))}
                  >
                    {u.name}
                  </EntityButton>
                ))}
            </PlaneGroup>
          ) : null}

          <PlaneGroup label="Roles">
            {(section?.roles ?? [])
              .filter((r) => filterText(r.name))
              .map((r) => (
                <EntityButton
                  key={r.id}
                  selected={search.kind === "role" && search.id === r.id}
                  onClick={() => {
                    setSelectedScopes([...r.scopes]);
                    setSearch(openAccessEntity(search, plane, "role", r.id));
                  }}
                >
                  {r.name}
                </EntityButton>
              ))}
          </PlaneGroup>

          <PlaneGroup label="API keys">
            {(section?.keys ?? [])
              .filter((k) => filterText(k.name))
              .map((k) => (
                <EntityButton
                  key={k.id}
                  selected={search.kind === "key" && search.id === k.id}
                  onClick={() => {
                    setBlast(null);
                    setSearch(openAccessEntity(search, plane, "key", k.id));
                    loadBlast.mutate(k.id);
                  }}
                >
                  {k.name}
                  {k.unused90d ? <span className="text-[var(--oke-muted)]"> · 90d+</span> : null}
                  {k.revokedAt != null ? (
                    <span className="text-[var(--oke-danger)]"> · revoked</span>
                  ) : null}
                </EntityButton>
              ))}
          </PlaneGroup>

          {section?.invites && section.invites.length > 0 ? (
            <PlaneGroup label="Invitations">
              {section.invites
                .filter((i) => filterText(i.email))
                .map((i) => (
                  <EntityButton
                    key={i.id}
                    selected={search.kind === "invite" && search.id === i.id}
                    onClick={() => setSearch(openAccessEntity(search, "operator", "invite", i.id))}
                  >
                    {i.email}
                    {i.expired ? (
                      <span className="text-[var(--oke-danger)]"> · expired</span>
                    ) : null}
                  </EntityButton>
                ))}
            </PlaneGroup>
          ) : null}

          <div className="border-t border-[var(--oke-line)] p-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setSelectedScopes([]);
                setKeyName("");
                setSearch({ ...search, plane, view: "create-key", kind: undefined, id: undefined });
              }}
            >
              Create API key
            </Button>
          </div>
        </section>

        <section
          aria-label="Access detail"
          className="min-w-0 flex-1 overflow-y-auto px-4 py-3"
          aria-live="polite"
        >
          {search.view === "create-key" ? (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">Create API key</h2>
              <p className="text-sm text-[var(--oke-muted)]">
                Only scopes you hold on the {plane} plane are shown — impossibility taught by
                absence. No preview.
              </p>
              <label className="flex flex-col gap-1 text-sm">
                <span>Name</span>
                <Input
                  aria-label="API key name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.currentTarget.value)}
                />
              </label>
              <ScopePicker grantable={grantable} selected={selectedScopes} onToggle={toggleScope} />
              <Button
                type="button"
                disabled={createKey.isPending || !keyName.trim()}
                onClick={() => createKey.mutate()}
              >
                Create key
              </Button>
              {createKey.error ? (
                <p role="alert" className="text-sm text-[var(--oke-danger)]">
                  {(createKey.error as Error).message}
                </p>
              ) : null}
            </div>
          ) : openKey ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-medium">{openKey.name}</h2>
                <p className="font-mono text-sm text-[var(--oke-muted)]">{openKey.id}</p>
                <ul className="mt-2 font-mono text-sm">
                  {openKey.scopes.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>

              <section aria-label="Revocation blast radius" className="space-y-1">
                <h3 className="text-sm font-medium">Revocation blast radius</h3>
                {blastLines ? (
                  <>
                    <p className="text-sm" role={blastLines.warn ? "alert" : "status"}>
                      {blastLines.volume}
                    </p>
                    <p className="text-sm text-[var(--oke-muted)]">{blastLines.lastUsed}</p>
                    <p className="text-sm text-[var(--oke-muted)]">{blastLines.sources}</p>
                    <p className="text-sm" role="status">
                      {blastLines.residual}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--oke-muted)]">Loading…</p>
                )}
              </section>

              {openKey.revokedAt == null ? (
                <section aria-label="Revoke or rotate" className="space-y-3">
                  <h3 className="text-sm font-medium">Revoke / rotate</h3>
                  <p className="text-sm text-[var(--oke-muted)]">
                    Irreversible. Type the phrase and a reason. No dry-run.
                  </p>
                  <label className="flex flex-col gap-1 text-sm">
                    <span>Type REVOKE or ROTATE</span>
                    <Input
                      aria-label="Type REVOKE or ROTATE to confirm"
                      value={typed}
                      onChange={(e) => setTyped(e.currentTarget.value)}
                      autoComplete="off"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span>Reason</span>
                    <Input
                      aria-label="Reason"
                      value={reason}
                      onChange={(e) => setReason(e.currentTarget.value)}
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      disabled={revokeKey.isPending}
                      onClick={() => revokeKey.mutate()}
                    >
                      Revoke key
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={rotateKey.isPending}
                      onClick={() => rotateKey.mutate()}
                    >
                      Rotate key
                    </Button>
                  </div>
                  {revokeKey.error || rotateKey.error ? (
                    <p role="alert" className="text-sm text-[var(--oke-danger)]">
                      {((revokeKey.error ?? rotateKey.error) as Error).message}
                    </p>
                  ) : null}
                </section>
              ) : (
                <p role="status" className="text-sm text-[var(--oke-danger)]">
                  Revoked {openKey.revokedAt ? new Date(openKey.revokedAt).toISOString() : ""}
                </p>
              )}

              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch({ ...search, view: "effective" });
                  loadEffective.mutate();
                }}
              >
                Effective permissions
              </Button>
            </div>
          ) : openRole ? (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">{openRole.name}</h2>
              <p className="text-sm text-[var(--oke-muted)]">{openRole.description}</p>
              <ScopePicker grantable={grantable} selected={selectedScopes} onToggle={toggleScope} />
              <Button
                type="button"
                disabled={grantRole.isPending}
                onClick={() => grantRole.mutate()}
              >
                Save role grants
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch({ ...search, view: "effective" });
                  loadEffective.mutate();
                }}
              >
                Effective permissions
              </Button>
            </div>
          ) : openOperator || openUser ? (
            <div className="space-y-4">
              <h2 className="text-lg font-medium">{openOperator?.name ?? openUser?.name}</h2>
              <p className="text-sm text-[var(--oke-muted)]">
                {openOperator?.email ?? openUser?.email}
              </p>
              <Button
                type="button"
                onClick={() => {
                  setSearch({ ...search, view: "effective" });
                  loadEffective.mutate();
                }}
              >
                Effective permissions
              </Button>
            </div>
          ) : search.view === "effective" && provenance.length > 0 ? (
            <EffectiveTable provenance={provenance} />
          ) : (
            <p className="text-sm text-[var(--oke-muted)]">
              Choose an identity, role, or key. Planes stay separate; scopes you cannot grant do not
              appear.
            </p>
          )}

          {search.view === "effective" &&
          provenance.length > 0 &&
          (openKey || openRole || openOperator || openUser) ? (
            <div className="mt-6">
              <EffectiveTable provenance={provenance} />
            </div>
          ) : null}
        </section>
      </div>

      {onceSecret ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
        >
          <section
            aria-label="New API key secret"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="once-secret-title"
            className="max-w-lg space-y-4 border border-[var(--oke-line)] bg-[var(--oke-bg)] p-6"
          >
            <h2 id="once-secret-title" className="text-lg font-medium">
              New API key secret
            </h2>
            <p role="alert" className="text-sm text-[var(--oke-danger)]">
              {ONCE_SECRET_WARNING}
            </p>
            <p className="break-all font-mono text-sm">{onceSecret.secret}</p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={onceSecret.acknowledged}
                onChange={(e) =>
                  setOnceSecret({
                    ...onceSecret,
                    acknowledged: e.currentTarget.checked,
                  })
                }
              />
              <span>{ONCE_SECRET_ACK_LABEL}</span>
            </label>
            <Button
              type="button"
              disabled={!canDismissOnceSecret(onceSecret)}
              onClick={() => setOnceSecret(null)}
            >
              Dismiss secret
            </Button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PlaneGroup({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section aria-label={label} className="border-t border-[var(--oke-line)]">
      <h3 className="px-4 py-2 text-xs uppercase tracking-wide text-[var(--oke-muted)]">{label}</h3>
      <ul className="pb-2">{children}</ul>
    </section>
  );
}

function EntityButton({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onClick}
        className={clsx(
          "flex min-h-8 w-full items-center px-4 text-left text-sm",
          selected ? "bg-[var(--oke-accent)]/15 text-[var(--oke-fg)]" : "text-[var(--oke-fg)]",
        )}
      >
        {children}
      </button>
    </li>
  );
}

function ScopePicker({
  grantable,
  selected,
  onToggle,
}: {
  readonly grantable: readonly string[];
  readonly selected: readonly string[];
  readonly onToggle: (scope: string) => void;
}) {
  return (
    <section aria-label="Grantable scopes" className="space-y-2">
      <h3 className="text-sm font-medium">Grantable scopes</h3>
      <p className="text-sm text-[var(--oke-muted)]">Only scopes you hold appear</p>
      {grantable.length === 0 ? (
        <p role="status" className="text-sm text-[var(--oke-muted)]">
          No grantable scopes on this plane
        </p>
      ) : (
        <ul className="space-y-1">
          {grantable.map((scope) => (
            <li key={scope}>
              <label className="flex min-h-8 items-center gap-2 font-mono text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(scope)}
                  onChange={() => onToggle(scope)}
                />
                {scope}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EffectiveTable({
  provenance,
}: {
  readonly provenance: readonly { scope: string; sources: string }[];
}) {
  return (
    <section aria-label="Effective permissions">
      <h2 className="mb-2 text-lg font-medium">Effective permissions</h2>
      <p className="mb-3 text-sm text-[var(--oke-muted)]">
        Every permission with provenance — inverse of the Gates simulator
      </p>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Effective permissions with provenance</caption>
        <thead>
          <tr className="border-b border-[var(--oke-line)]">
            <th scope="col" className="py-2 pr-4 font-medium">
              Scope
            </th>
            <th scope="col" className="py-2 font-medium">
              Granted by
            </th>
          </tr>
        </thead>
        <tbody>
          {provenance.map((row) => (
            <tr key={row.scope} className="border-b border-[var(--oke-line)]">
              <td className="py-2 pr-4 font-mono">{row.scope}</td>
              <td className="py-2 text-[var(--oke-muted)]">{row.sources}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
