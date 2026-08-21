/**
 * Access page — API keys as issuer credentials, not a second permission system.
 */

import { Key01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type JSX } from "react";
import {
  accessCreateKey,
  accessKeyBlast,
  accessRevokeKey,
  accessRotateKey,
  accessUpdateKey,
  clientErrorText,
  type AccessKeyRow,
  type AccessUserRow,
} from "@/client.ts";
import {
  EXPLORER_BAND_CLASS,
  EXPLORER_BAND_HEADER_CLASS,
  EXPLORER_BAND_LABEL_CLASS,
  EXPLORER_COUNT_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_PAGE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_SPLIT,
  EXPLORER_TOOLBAR_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { ExplorerStartToggle } from "@/components/explorer/explorer-start-toggle.tsx";
import { useExplorerStartPanel } from "@/components/explorer/use-explorer-start-panel.ts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetError,
  SheetField,
  SheetFooterButton,
} from "@/components/ui/sheet-form.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils.ts";
import { ACCESS_LIST_QUERY_KEY, useAccessList } from "./data/use-access.ts";
import { AccessSecretSheet } from "./sheets/access-secret-sheet.tsx";
import { useAccessSelection } from "./state/access-selection.ts";

/**
 * Access explorer — create, edit, revoke, rotate, usage, working call.
 */
export function AccessPage(): JSX.Element {
  const list = useAccessList();
  const qc = useQueryClient();
  const { query, selectedKey, action, setQuery, setSelectedKey, setAction } = useAccessSelection();
  const start = useExplorerStartPanel();
  const [secret, setSecret] = useState<string | null>(null);
  const [secretTitle, setSecretTitle] = useState("New API key");

  const keys = useMemo(() => {
    const user = list.data?.userPlane.keys ?? [];
    const ops = list.data?.operatorPlane.keys ?? [];
    return [...user, ...ops];
  }, [list.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.id.toLowerCase().includes(q) ||
        row.scopes.some((s) => s.toLowerCase().includes(q)),
    );
  }, [keys, query]);

  const selected =
    filtered.find((row) => row.id === selectedKey) ?? keys.find((row) => row.id === selectedKey);

  const blast = useQuery({
    queryKey: ["console.access.blast", selected?.id],
    queryFn: async () => {
      if (!selected) throw new Error("no key");
      const res = await accessKeyBlast(selected.id);
      if (res.error || !res.data) throw new Error(res.error?.message ?? "blast failed");
      return res.data;
    },
    enabled: selected !== undefined,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ACCESS_LIST_QUERY_KEY });
  };

  const create = useMutation({
    mutationFn: accessCreateKey,
    onSuccess: (res) => {
      if (res.error || !res.data)
        throw new Error(res.error ? clientErrorText(res.error) : "create failed");
      setSecretTitle("New API key");
      setSecret(res.data.secret);
      setSelectedKey(res.data.key.id);
      setAction(null);
      invalidate();
    },
  });

  const rotate = useMutation({
    mutationFn: () =>
      accessRotateKey({
        keyId: selected!.id,
        confirmation: "ROTATE",
        reason: "Console rotate",
      }),
    onSuccess: (res) => {
      if (res.error || !res.data)
        throw new Error(res.error ? clientErrorText(res.error) : "rotate failed");
      setSecretTitle("Rotated API key");
      setSecret(res.data.secret);
      setAction(null);
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (reason: string) =>
      accessRevokeKey({
        keyId: selected!.id,
        confirmation: "REVOKE",
        reason,
      }),
    onSuccess: (res) => {
      if (res.error || !res.data)
        throw new Error(res.error ? clientErrorText(res.error) : "revoke failed");
      setAction(null);
      invalidate();
    },
  });

  const update = useMutation({
    mutationFn: accessUpdateKey,
    onSuccess: (res) => {
      if (res.error || !res.data)
        throw new Error(res.error ? clientErrorText(res.error) : "update failed");
      setAction(null);
      invalidate();
    },
  });

  const startToggle = (
    <ExplorerStartToggle
      open={start.open}
      onToggle={start.toggle}
      noun="keys"
      controlsId="access-list"
      dataSlot="access-list-toggle"
    />
  );

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="access-page">
      <ResizablePanelGroup orientation="horizontal">
        {start.open ? (
          <>
            <ResizablePanel {...EXPLORER_SPLIT.start} className="min-w-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className={EXPLORER_TOOLBAR_CLASS}>
                  {startToggle}
                  <input
                    data-slot="access-search-input"
                    className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs outline-none"
                    placeholder="Search keys"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <ToolbarTip label="Create key" className="flex self-stretch">
                    <button
                      type="button"
                      className={EXPLORER_ICON_BUTTON_CLASS}
                      data-slot="access-create"
                      onClick={() => setAction("create")}
                    >
                      <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                    </button>
                  </ToolbarTip>
                </div>
                <div
                  id="access-list"
                  data-slot="access-list"
                  className="min-h-0 flex-1 overflow-y-auto"
                >
                  <AccessBand
                    label="User"
                    rows={filtered.filter((k) => k.plane === "user")}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                  />
                  <AccessBand
                    label="Operator"
                    rows={filtered.filter((k) => k.plane === "operator")}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                  />
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle />
          </>
        ) : null}
        <ResizablePanel {...EXPLORER_SPLIT.end} className="min-w-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className={EXPLORER_TOOLBAR_CLASS}>
              {!start.open ? startToggle : null}
              <p className="flex items-center px-2 text-xs text-muted-foreground">
                {selected ? selected.name : "Select a key"}
              </p>
            </div>
            {selected ? (
              <AccessDetail
                keyRow={selected}
                blast={blast.data}
                onEdit={() => setAction("edit")}
                onRevoke={() => setAction("revoke")}
                onRotate={() => rotate.mutate()}
                rotatePending={rotate.isPending}
                rotateError={rotate.error instanceof Error ? rotate.error.message : null}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Keys are the issuer with fewer gates. Create one to mint a secret once.
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <AccessCreateSheet
        open={action === "create"}
        users={list.data?.userPlane.users ?? []}
        userScopes={list.data?.userPlane.grantableScopes ?? []}
        operatorScopes={list.data?.operatorPlane.grantableScopes ?? []}
        pending={create.isPending}
        error={create.error instanceof Error ? create.error.message : null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        onSubmit={(input) => create.mutate(input)}
      />
      {selected ? (
        <AccessEditSheet
          open={action === "edit"}
          keyRow={selected}
          pending={update.isPending}
          error={update.error instanceof Error ? update.error.message : null}
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          onSubmit={(input) => update.mutate({ keyId: selected.id, ...input })}
        />
      ) : null}
      {selected ? (
        <AccessRevokeSheet
          open={action === "revoke"}
          name={selected.name}
          pending={revoke.isPending}
          error={revoke.error instanceof Error ? revoke.error.message : null}
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          onSubmit={(reason) => revoke.mutate(reason)}
        />
      ) : null}
      <AccessSecretSheet secret={secret} title={secretTitle} onDismiss={() => setSecret(null)} />
    </div>
  );
}

function AccessBand(props: {
  readonly label: string;
  readonly rows: readonly AccessKeyRow[];
  readonly selectedKey: string | null;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <div className={EXPLORER_BAND_CLASS}>
      <div className={EXPLORER_BAND_HEADER_CLASS}>
        <span className={EXPLORER_BAND_LABEL_CLASS}>{props.label}</span>
        <span className={EXPLORER_COUNT_CLASS}>{props.rows.length}</span>
      </div>
      {props.rows.map((row) => {
        const selected = row.id === props.selectedKey;
        return (
          <button
            key={row.id}
            type="button"
            data-slot="access-key-row"
            className={cn(EXPLORER_ROW_CLASS, selected && EXPLORER_ROW_SELECTED_CLASS)}
            onClick={() => props.onSelect(row.id)}
          >
            <span className={cn(EXPLORER_RAIL_CLASS, selected && "bg-sky-500")} />
            <HugeiconsIcon icon={Key01Icon} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{row.name}</span>
            {row.revokedAt !== null ? (
              <span className="ml-auto text-[10px] text-muted-foreground">revoked</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function AccessDetail(props: {
  readonly keyRow: AccessKeyRow;
  readonly blast:
    | {
        readonly callVolume: number;
        readonly lastUsedAt: number | null;
        readonly sourceAddresses: readonly string[];
        readonly residualAccessNote: string;
      }
    | undefined;
  readonly onEdit: () => void;
  readonly onRevoke: () => void;
  readonly onRotate: () => void;
  readonly rotatePending: boolean;
  readonly rotateError: string | null;
}): JSX.Element {
  const row = props.keyRow;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-slot="access-detail">
      <section className="border-b border-border/60 px-4 py-3">
        <h2 className={SECTION_HEAD_CLASS}>Key</h2>
        <dl className="mt-2 grid gap-1 text-xs">
          <Fact label="Id" value={row.id} />
          <Fact label="Plane" value={row.plane} />
          <Fact label="Scopes" value={row.scopes.join(", ") || "—"} />
          <Fact
            label="Expires"
            value={row.expiresAt ? new Date(row.expiresAt).toISOString() : "never"}
          />
          <Fact label="Allowlist" value={row.ipAllowlist.join(", ") || "any"} />
          <Fact
            label="Rate"
            value={row.rateLimit ? `${row.rateLimit.max} / ${row.rateLimit.per}` : "none"}
          />
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="text-[11px] underline" onClick={props.onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="text-[11px] underline"
            disabled={props.rotatePending || row.revokedAt !== null}
            onClick={props.onRotate}
          >
            Rotate
          </button>
          <button
            type="button"
            className="text-[11px] text-destructive underline"
            disabled={row.revokedAt !== null}
            onClick={props.onRevoke}
          >
            Revoke
          </button>
        </div>
        {props.rotateError ? (
          <p className="mt-2 text-[11px] text-destructive">{props.rotateError}</p>
        ) : null}
      </section>
      <section className="border-b border-border/60 px-4 py-3">
        <h2 className={SECTION_HEAD_CLASS}>Usage</h2>
        <dl className="mt-2 grid gap-1 text-xs">
          <Fact label="Calls" value={String(props.blast?.callVolume ?? 0)} />
          <Fact
            label="Last used"
            value={
              props.blast?.lastUsedAt ? new Date(props.blast.lastUsedAt).toISOString() : "never"
            }
          />
          <Fact label="Source IPs" value={props.blast?.sourceAddresses.join(", ") || "—"} />
          <Fact label="Residual" value={props.blast?.residualAccessNote ?? "—"} />
        </dl>
      </section>
      <section className="px-4 py-3" data-slot="access-call-example">
        <h2 className={SECTION_HEAD_CLASS}>Request</h2>
        <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-muted-foreground">
          {`GET /secure
Authorization: Bearer <secret>`}
        </pre>
        <h2 className={`${SECTION_HEAD_CLASS} mt-4`}>Response</h2>
        <pre className="mt-2 font-mono text-[11px] text-muted-foreground">{`{ "ok": true }`}</pre>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Seed the Bearer secret from create / rotate. The key is the issuer; gates see{" "}
          {row.scopes.join(", ") || "its scopes"}.
        </p>
      </section>
    </div>
  );
}

function Fact(props: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-all">{props.value}</dd>
    </div>
  );
}

function AccessCreateSheet(props: {
  readonly open: boolean;
  readonly users: readonly AccessUserRow[];
  readonly userScopes: readonly string[];
  readonly operatorScopes: readonly string[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: {
    readonly plane: "user" | "operator";
    readonly name: string;
    readonly scopes: readonly string[];
    readonly creatorUserId?: string;
  }) => void;
}): JSX.Element {
  const [plane, setPlane] = useState<"user" | "operator">("user");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("");
  const [creatorUserId, setCreatorUserId] = useState("");

  const grantable = plane === "user" ? props.userScopes : props.operatorScopes;
  const ready =
    name.trim().length > 0 && !props.pending && (plane === "operator" || creatorUserId.length > 0);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="access-create-sheet"
      >
        <SheetHeader>
          <SheetTitle>Create API key</SheetTitle>
          <SheetDescription>
            User-plane keys require an issuer. The key cannot exceed that user&apos;s grants.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <SheetField label="Plane">
            <select
              className={SHEET_CONTROL}
              value={plane}
              onChange={(e) => setPlane(e.target.value as "user" | "operator")}
            >
              <option value="user">User</option>
              <option value="operator">Operator</option>
            </select>
          </SheetField>
          {plane === "user" ? (
            <SheetField label="Issuer">
              <select
                className={SHEET_CONTROL}
                value={creatorUserId}
                onChange={(e) => setCreatorUserId(e.target.value)}
                data-slot="access-creator-user"
              >
                <option value="">Select user</option>
                {props.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.id})
                  </option>
                ))}
              </select>
            </SheetField>
          ) : null}
          <SheetField label="Name">
            <Input
              className={SHEET_CONTROL}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </SheetField>
          <SheetField label="Scopes">
            <Input
              className={SHEET_CONTROL}
              placeholder={grantable.slice(0, 3).join(", ")}
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
            />
          </SheetField>
          {props.error ? <SheetError slot="access-create-error">{props.error}</SheetError> : null}
        </div>
        <SheetFooter>
          <SheetFooterButton
            disabled={!ready}
            onClick={() => {
              const requested = scopes
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              props.onSubmit({
                plane,
                name: name.trim(),
                scopes: requested.length > 0 ? requested : grantable.slice(0, 1),
                ...(plane === "user" ? { creatorUserId } : {}),
              });
            }}
          >
            Create
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AccessEditSheet(props: {
  readonly open: boolean;
  readonly keyRow: AccessKeyRow;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (input: { readonly name: string; readonly scopes: readonly string[] }) => void;
}): JSX.Element {
  const [name, setName] = useState(props.keyRow.name);
  const [scopes, setScopes] = useState(props.keyRow.scopes.join(", "));

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="access-edit-sheet"
      >
        <SheetHeader>
          <SheetTitle>Edit key</SheetTitle>
          <SheetDescription>
            Scopes re-attenuate against the stored issuer ceiling.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <SheetField label="Name">
            <Input
              className={SHEET_CONTROL}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </SheetField>
          <SheetField label="Scopes">
            <Input
              className={SHEET_CONTROL}
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
            />
          </SheetField>
          {props.error ? <SheetError slot="access-edit-error">{props.error}</SheetError> : null}
        </div>
        <SheetFooter>
          <SheetFooterButton
            disabled={props.pending || name.trim().length === 0}
            onClick={() =>
              props.onSubmit({
                name: name.trim(),
                scopes: scopes
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s.length > 0),
              })
            }
          >
            Save
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AccessRevokeSheet(props: {
  readonly open: boolean;
  readonly name: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (reason: string) => void;
}): JSX.Element {
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-md"
        data-slot="access-revoke-sheet"
      >
        <SheetHeader>
          <SheetTitle>Revoke {props.name}</SheetTitle>
          <SheetDescription>Type REVOKE and a reason. Irreversible.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <SheetField label="Confirm">
            <Input
              className={SHEET_CONTROL}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </SheetField>
          <SheetField label="Reason">
            <Input
              className={SHEET_CONTROL}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </SheetField>
          {props.error ? <SheetError slot="access-revoke-error">{props.error}</SheetError> : null}
        </div>
        <SheetFooter>
          <SheetFooterButton
            variant="destructive"
            disabled={props.pending || phrase !== "REVOKE" || reason.trim().length < 3}
            onClick={() => props.onSubmit(reason.trim())}
          >
            Revoke
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
