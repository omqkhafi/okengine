/**
 * Vault page — posture scan, deep search, set / rotate / rotate-master.
 */

import {
  FileExportIcon,
  Key01Icon,
  MoreHorizontalCircle01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type JSX } from "react";
import {
  clientErrorText,
  vaultAuditVerify,
  vaultRotate,
  vaultRotateMaster,
  vaultSet,
} from "@/client.ts";
import {
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_PAGE_CLASS,
  EXPLORER_SPLIT,
  EXPLORER_TOOLBAR_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils.ts";
import { useVaultList, VAULT_LIST_QUERY_KEY } from "./data/use-vault-list.ts";
import { VaultDetail } from "./detail/vault-detail.tsx";
import { VaultOverview } from "./detail/vault-overview.tsx";
import { VaultList } from "./explorer/vault-list.tsx";
import { VaultPostureStrip } from "./explorer/vault-posture-strip.tsx";
import { VaultSearch } from "./explorer/vault-search.tsx";
import { formatVaultBackend } from "./lib/backend.ts";
import { exportSafeList } from "./lib/export-safe.ts";
import { groupByKind } from "./lib/group.ts";
import { summarizePosture } from "./lib/posture.ts";
import { formatRewrapProgress } from "./lib/progress.ts";
import type { VaultAuditVerifyResult, VaultRecord } from "./lib/types.ts";
import { VaultMasterKeySheet } from "./sheets/vault-master-key-sheet.tsx";
import { VaultRotateMasterSheet } from "./sheets/vault-rotate-master-sheet.tsx";
import { VaultSecuritySheet } from "./sheets/vault-security-sheet.tsx";
import { VaultVerifySheet } from "./sheets/vault-verify-sheet.tsx";
import { VaultWriteSheet } from "./sheets/vault-write-sheet.tsx";
import { useVaultSelection } from "./state/vault-selection.ts";

/**
 * Vault explorer — search, posture, list / detail.
 */
export function VaultPage(): JSX.Element {
  const list = useVaultList();
  const qc = useQueryClient();
  const { query, selectedName, action, setQuery, setSelectedName, setAction } = useVaultSelection();
  const [now] = useState(() => Date.now());
  const [securityOpen, setSecurityOpen] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [rotateMasterError, setRotateMasterError] = useState<string | null>(null);
  const [shownMasterKey, setShownMasterKey] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lastKek, setLastKek] = useState<number | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);
  const [verifyBreak, setVerifyBreak] = useState<VaultAuditVerifyResult | null>(null);

  const secrets = (list.data?.secrets ?? []) as readonly VaultRecord[];
  const env = list.data?.env ?? "dev";
  const backend = list.data?.backend ?? null;
  const backendCard = useMemo(() => formatVaultBackend(backend), [backend]);
  const groups = useMemo(() => groupByKind(secrets, query, now), [secrets, query, now]);
  const summary = useMemo(() => summarizePosture(secrets, now), [secrets, now]);
  const visible = useMemo(() => groups.flatMap((g) => g.secrets), [groups]);
  const matchCount = visible.length;
  const selected = visible.find((s) => s.name === selectedName) ?? visible[0] ?? null;
  const progress = formatRewrapProgress({
    kekVersion: lastKek ?? backend?.status?.kekVersion ?? 1,
    remaining,
    rewrapTargetKekVersion: backend?.status?.rewrapTargetKekVersion ?? null,
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
      const input = document.querySelector<HTMLInputElement>("[data-slot='vault-search-input']");
      input?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: VAULT_LIST_QUERY_KEY });
  };

  const exportFingerprints = () => {
    const payload = exportSafeList(secrets);
    void navigator.clipboard?.writeText(payload);
    setExportNote("Exported fingerprints only (no secret values)");
  };

  const writeMut = useMutation({
    mutationFn: async (input: {
      readonly mode: "set" | "rotate";
      readonly name: string;
      readonly value: string;
      readonly confirmation: string;
      readonly reason: string;
    }) => {
      if (input.value.trim().length === 0) throw new Error("New value is required");
      const call = input.mode === "set" ? vaultSet : vaultRotate;
      const res = await call({
        name: input.name,
        value: input.value,
        confirmation: input.confirmation,
        reason: input.reason,
      });
      if (res.error) throw new Error(clientErrorText(res.error));
      return res.data;
    },
    onSuccess: async () => {
      setWriteError(null);
      setAction(null);
      await invalidate();
    },
    onError: (err: Error) => {
      setWriteError(err.message);
    },
  });

  const rotateMasterMut = useMutation({
    mutationFn: async (input: { readonly confirmation: string; readonly reason: string }) => {
      let lastRemaining = 0;
      let lastKekVersion = backend?.status?.kekVersion ?? 1;
      for (;;) {
        const res = await vaultRotateMaster(input);
        if (res.error) throw new Error(clientErrorText(res.error));
        if (!res.data) throw new Error("Empty rotate-master response");
        lastRemaining = res.data.remaining;
        lastKekVersion = res.data.kekVersion;
        setRemaining(res.data.remaining);
        setLastKek(res.data.kekVersion);
        if (res.data.masterKey) setShownMasterKey(res.data.masterKey);
        await invalidate();
        if (res.data.remaining === 0) break;
      }
      return { remaining: lastRemaining, kekVersion: lastKekVersion };
    },
    onSuccess: () => {
      setRotateMasterError(null);
      setAction(null);
    },
    onError: (err: Error) => {
      setRotateMasterError(err.message);
    },
  });

  const verifyMut = useMutation({
    mutationFn: async () => {
      const res = await vaultAuditVerify();
      if (res.error) throw new Error(clientErrorText(res.error));
      if (!res.data) throw new Error("Empty verify response");
      return res.data;
    },
    onSuccess: (data) => {
      if (data.ok) {
        setVerifyBreak(null);
        setVerifyNote("chain intact");
      } else {
        setVerifyNote(null);
        setVerifyBreak(data);
      }
    },
  });

  return (
    <div className={EXPLORER_PAGE_CLASS} data-slot="vault-page">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.start.defaultSize}
          minSize={EXPLORER_SPLIT.start.minSize}
          className="min-h-0 overflow-hidden"
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className={cn(EXPLORER_TOOLBAR_CLASS, "relative z-20 pr-1.5")}>
              <VaultSearch query={query} secrets={secrets} onQueryChange={setQuery} />
              {exportNote ? (
                <span className="sr-only" role="status">
                  {exportNote}
                </span>
              ) : null}
              <ToolbarTip label="Verify the audit hash chain">
                <button
                  type="button"
                  aria-label="Verify chain"
                  disabled={verifyMut.isPending}
                  onClick={() => verifyMut.mutate()}
                  className={EXPLORER_ICON_BUTTON_CLASS}
                >
                  <HugeiconsIcon icon={SecurityCheckIcon} className="size-3.5" />
                </button>
              </ToolbarTip>
              <DropdownMenu>
                <ToolbarTip label="Vault security">
                  <DropdownMenuTrigger
                    render={(props) => (
                      <button
                        {...props}
                        type="button"
                        aria-label="Vault security"
                        className={EXPLORER_ICON_BUTTON_CLASS}
                      >
                        <HugeiconsIcon icon={MoreHorizontalCircle01Icon} className="size-3.5" />
                      </button>
                    )}
                  />
                </ToolbarTip>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setSecurityOpen(true)}>
                      Security
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setAction("rotate-master")}>
                      <HugeiconsIcon icon={Key01Icon} data-icon="inline-start" />
                      Rotate master key
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={exportFingerprints}>
                      <HugeiconsIcon icon={FileExportIcon} data-icon="inline-start" />
                      Export fingerprints
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={verifyMut.isPending}
                    onClick={() => verifyMut.mutate()}
                  >
                    <HugeiconsIcon icon={SecurityCheckIcon} data-icon="inline-start" />
                    Verify audit chain
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <VaultPostureStrip
              card={backendCard}
              env={env}
              summary={summary}
              query={query}
              progress={progress}
              verifyNote={verifyNote}
              onQueryChange={setQuery}
              onOpenSecurity={() => setSecurityOpen(true)}
            />
            <VaultList
              groups={groups}
              selectedName={selected?.name ?? selectedName}
              loading={list.isLoading}
              matchCount={matchCount}
              totalCount={secrets.length}
              now={now}
              onSelect={setSelectedName}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          defaultSize={EXPLORER_SPLIT.end.defaultSize}
          minSize={EXPLORER_SPLIT.end.minSize}
          className="min-h-0 overflow-hidden"
        >
          {selected ? (
            <VaultDetail
              row={selected}
              env={env}
              now={now}
              onSet={() => setAction("set")}
              onRotate={() => setAction("rotate")}
              onQueryChange={setQuery}
            />
          ) : (
            <VaultOverview
              loading={list.isLoading}
              hasContracts={secrets.length > 0}
              query={query}
              onClearQuery={() => setQuery("")}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <VaultWriteSheet
        open={action === "set" || action === "rotate"}
        onOpenChange={(open) => {
          if (!open) {
            setWriteError(null);
            setAction(null);
          }
        }}
        mode={action === "rotate" ? "rotate" : "set"}
        name={selected?.name ?? ""}
        sensitive={selected?.sensitive ?? true}
        pending={writeMut.isPending}
        error={writeError}
        onConfirm={(input) => {
          if (!selected) return;
          writeMut.mutate({
            mode: action === "rotate" ? "rotate" : "set",
            name: selected.name,
            ...input,
          });
        }}
      />

      <VaultRotateMasterSheet
        open={action === "rotate-master"}
        onOpenChange={(open) => {
          if (!open) {
            setRotateMasterError(null);
            setAction(null);
          }
        }}
        pending={rotateMasterMut.isPending}
        error={rotateMasterError}
        onConfirm={(input) => rotateMasterMut.mutate(input)}
      />

      <VaultSecuritySheet
        open={securityOpen}
        onOpenChange={setSecurityOpen}
        card={backendCard}
        env={env}
        progress={progress}
        verifyPending={verifyMut.isPending}
        verifyNote={verifyNote}
        onVerify={() => verifyMut.mutate()}
        onRotateMaster={() => {
          setSecurityOpen(false);
          setAction("rotate-master");
        }}
        onExport={exportFingerprints}
      />

      <VaultMasterKeySheet masterKey={shownMasterKey} onDismiss={() => setShownMasterKey(null)} />

      <VaultVerifySheet result={verifyBreak} onClose={() => setVerifyBreak(null)} />
    </div>
  );
}
