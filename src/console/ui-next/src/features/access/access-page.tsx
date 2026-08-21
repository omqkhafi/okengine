/**
 * Access page — API keys as issuer credentials, not a second permission system.
 */

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type JSX } from "react";
import {
  accessCreateKey,
  accessKeyBlast,
  accessRevokeKey,
  accessRotateKey,
  accessUpdateKey,
  clientErrorText,
} from "@/client.ts";
import {
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_PAGE_CLASS,
  EXPLORER_SPLIT,
  EXPLORER_TOOLBAR_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { ExplorerEmpty } from "@/components/explorer/explorer-empty.tsx";
import { ExplorerSearch } from "@/components/explorer/explorer-search.tsx";
import { ExplorerStartToggle } from "@/components/explorer/explorer-start-toggle.tsx";
import { useExplorerStartPanel } from "@/components/explorer/use-explorer-start-panel.ts";
import { ConfirmSheet } from "@/components/ui/confirm-sheet.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { AccessDetail } from "./detail/access-detail.tsx";
import { ACCESS_LIST_QUERY_KEY, useAccessList } from "./data/use-access.ts";
import { AccessList } from "./explorer/access-list.tsx";
import { AccessCreateSheet } from "./sheets/access-create-sheet.tsx";
import { AccessEditSheet } from "./sheets/access-edit-sheet.tsx";
import { AccessRefreshSheet } from "./sheets/access-refresh-sheet.tsx";
import { AccessSecretSheet } from "./sheets/access-secret-sheet.tsx";
import { useAccessSelection } from "./state/access-selection.ts";

/**
 * Access explorer — create, edit, refresh expiry, revoke, rotate, usage, working call.
 */
export function AccessPage(): JSX.Element {
  const list = useAccessList();
  const qc = useQueryClient();
  const { query, selectedKey, action, setQuery, setSelectedKey, setAction } = useAccessSelection();
  const start = useExplorerStartPanel();
  const [now] = useState(() => Date.now());
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      event.preventDefault();
      document.querySelector<HTMLInputElement>("[data-slot='access-search-input']")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    mutationFn: (input: { readonly confirmation: "ROTATE"; readonly reason: string }) =>
      accessRotateKey({
        keyId: selected!.id,
        confirmation: input.confirmation,
        reason: input.reason,
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
    mutationFn: (input: { readonly confirmation: "REVOKE"; readonly reason: string }) =>
      accessRevokeKey({
        keyId: selected!.id,
        confirmation: input.confirmation,
        reason: input.reason,
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

  const refresh = useMutation({
    mutationFn: (expiresAt: number | null) =>
      accessUpdateKey({
        keyId: selected!.id,
        expiresAt,
      }),
    onSuccess: (res) => {
      if (res.error || !res.data)
        throw new Error(res.error ? clientErrorText(res.error) : "refresh failed");
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
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          panelRef={start.panelRef}
          collapsible
          collapsedSize={0}
          defaultSize={EXPLORER_SPLIT.start.defaultSize}
          minSize={EXPLORER_SPLIT.start.minSize}
          onResize={start.onResize}
          className="min-h-0 overflow-hidden"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className={EXPLORER_TOOLBAR_CLASS}>
              <ExplorerSearch
                data-slot="access-search-input"
                placeholder="Search keys"
                aria-label="Search keys"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ToolbarTip label="Create key" className="flex self-stretch">
                <button
                  type="button"
                  className={EXPLORER_ICON_BUTTON_CLASS}
                  data-slot="access-create"
                  aria-label="Create key"
                  onClick={() => setAction("create")}
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
                </button>
              </ToolbarTip>
            </div>
            <AccessList
              rows={filtered}
              selectedKey={selectedKey}
              query={query}
              loading={list.isLoading}
              onSelect={setSelectedKey}
            />
          </div>
        </ResizablePanel>
        {start.open ? <ResizableHandle withHandle /> : null}
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.end.defaultSize}
          minSize={EXPLORER_SPLIT.end.minSize}
          className="min-h-0 overflow-hidden"
        >
          {selected ? (
            <AccessDetail
              keyRow={selected}
              blast={blast.data}
              now={now}
              leading={startToggle}
              onEdit={() => setAction("edit")}
              onRefresh={() => setAction("refresh")}
              onRevoke={() => setAction("revoke")}
              onRotate={() => setAction("rotate")}
              rotatePending={rotate.isPending}
            />
          ) : (
            <ExplorerEmpty
              icon={ELEMENT_ICONS.gate.icon}
              iconClassName="border-border/70"
              title={
                list.isLoading ? "Loading keys…" : keys.length > 0 ? "Select a key" : "No keys yet"
              }
              leading={startToggle}
              description={
                list.isLoading ? (
                  "Reading planes and grantable scopes."
                ) : keys.length > 0 && query.trim().length > 0 ? (
                  <>
                    Nothing matches <span className="font-mono">{query}</span>.{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-foreground"
                      onClick={() => setQuery("")}
                    >
                      Clear search
                    </button>
                  </>
                ) : (
                  "Create one to mint a secret once."
                )
              }
            />
          )}
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
          users={list.data?.userPlane.users ?? []}
          operators={list.data?.operatorPlane.operators ?? []}
          operatorScopes={list.data?.operatorPlane.grantableScopes ?? []}
          pending={update.isPending}
          error={update.error instanceof Error ? update.error.message : null}
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          onSubmit={(input) => update.mutate({ keyId: selected.id, ...input })}
        />
      ) : null}
      {selected ? (
        <AccessRefreshSheet
          open={action === "refresh"}
          keyRow={selected}
          pending={refresh.isPending}
          error={refresh.error instanceof Error ? refresh.error.message : null}
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          onSubmit={(expiresAt) => refresh.mutate(expiresAt)}
        />
      ) : null}
      {selected ? (
        <ConfirmSheet
          open={action === "revoke"}
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          phrase="REVOKE"
          title={`Revoke ${selected.name}`}
          description="Irreversible. Residual sessions may continue for the access TTL."
          pending={revoke.isPending}
          error={revoke.error instanceof Error ? revoke.error.message : null}
          confirmLabel="Revoke key"
          slot="access-revoke-sheet"
          onConfirm={(input) => revoke.mutate({ confirmation: "REVOKE", reason: input.reason })}
        />
      ) : null}
      {selected ? (
        <ConfirmSheet
          open={action === "rotate"}
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          phrase="ROTATE"
          title={`Rotate ${selected.name}`}
          description="Mints a new secret once. The current secret stops after residual TTL."
          pending={rotate.isPending}
          error={rotate.error instanceof Error ? rotate.error.message : null}
          confirmLabel="Rotate key"
          confirmVariant="ghost"
          slot="access-rotate-sheet"
          onConfirm={(input) => rotate.mutate({ confirmation: "ROTATE", reason: input.reason })}
        />
      ) : null}
      <AccessSecretSheet secret={secret} title={secretTitle} onDismiss={() => setSecret(null)} />
    </div>
  );
}
