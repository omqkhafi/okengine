/**
 * Files explorer — folder browse, preview, upload, download, delete.
 */

import { useEffect, useMemo, useState, type DragEvent, type JSX } from "react";
import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  Delete02Icon,
  FileImportIcon,
  Folder01Icon,
  LeftToRightListBulletIcon,
  Search01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { StoreListChild, StoreListStore, StoreQueryResult } from "@/client.ts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/motion/checkbox.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils.ts";
import { useStoreDelete } from "../data/use-store-edit.ts";
import { StoreConfirmSheet } from "../grid/store-confirm-sheet.tsx";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { formatByteSize } from "../lib/kv-meta.ts";
import { fileKindFromName, fileKindLabel } from "../lib/files-meta.ts";
import {
  browseFileKeys,
  fileBrowserCrumbs,
  keysUnderPrefix,
  parentFilePrefix,
  searchFileKeys,
  type FileBrowseEntry,
  type FileKeyRow,
} from "../lib/files-tree.ts";
import { FileKindIcon } from "./file-kind-icon.tsx";
import { FilePreview } from "./file-preview.tsx";
import { FileUploadSheet } from "./file-upload-sheet.tsx";

/** Props for {@link FileExplorer}. */
export interface FileExplorerProps {
  readonly store: StoreListStore;
  readonly child: StoreListChild;
  readonly tenant?: string | null;
  readonly data: StoreQueryResult;
  readonly fetching?: boolean;
  readonly onRefresh: () => void;
}

type FilesView = "list" | "grid";

/**
 * Folder browser for a files bucket — replaces the key table.
 *
 * @param props - Store selection + listed keys
 */
export function FileExplorer({
  store,
  child,
  tenant,
  data,
  fetching = false,
  onRefresh,
}: FileExplorerProps): JSX.Element {
  const [prefix, setPrefix] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<FilesView>("list");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([]);
  const [deleting, setDeleting] = useState<readonly string[] | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setPrefix("");
    setQuery("");
    setSelectedKey(null);
    setChecked(new Set());
  }, [child.effectRef]);

  const keys: readonly FileKeyRow[] = data.keys ?? [];
  const searching = query.trim().length > 0;
  const listing = useMemo(() => {
    if (searching) {
      return { folders: [], files: searchFileKeys(keys, query) };
    }
    return browseFileKeys(keys, prefix);
  }, [keys, prefix, query, searching]);

  const entries: FileBrowseEntry[] = useMemo(
    () => [...listing.folders, ...listing.files],
    [listing],
  );
  const crumbs = fileBrowserCrumbs(prefix, child.name);
  const selectedFile = listing.files.find((f) => f.key === selectedKey) ?? null;
  const deleteMutation = useStoreDelete();

  const toggleChecked = (id: string, next: boolean) => {
    setChecked((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  };

  const onOpenEntry = (entry: FileBrowseEntry) => {
    if (entry.kind === "folder") {
      setPrefix(entry.prefix);
      setSelectedKey(null);
      setChecked(new Set());
      return;
    }
    setSelectedKey(entry.key);
  };

  const keysToDelete = (): string[] => {
    if (checked.size === 0 && selectedKey) return [selectedKey];
    const out: string[] = [];
    for (const id of checked) {
      if (id.endsWith("/")) out.push(...keysUnderPrefix(keys, id));
      else out.push(id);
    }
    return [...new Set(out)];
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length === 0) return;
    setPendingFiles(files);
    setUploadOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-slot="file-explorer">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
        <ToolbarTip label="Up one folder">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={prefix.length === 0 || searching}
            aria-label="Parent folder"
            onClick={() => {
              setPrefix(parentFilePrefix(prefix));
              setSelectedKey(null);
            }}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" />
          </Button>
        </ToolbarTip>
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap gap-1 text-[11px]">
            <BreadcrumbItem>
              {prefix.length === 0 || searching ? (
                <BreadcrumbPage className="font-mono text-[11px]">{child.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  href="#"
                  className="font-mono text-[11px]"
                  onClick={(event) => {
                    event.preventDefault();
                    setPrefix("");
                    setSelectedKey(null);
                  }}
                >
                  {child.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {crumbs.map((crumb, i) => (
              <span key={crumb.prefix} className="contents">
                <BreadcrumbSeparator className="mx-0" />
                <BreadcrumbItem>
                  {i === crumbs.length - 1 ? (
                    <BreadcrumbPage className="font-mono text-[11px]">{crumb.name}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      href="#"
                      className="font-mono text-[11px]"
                      onClick={(event) => {
                        event.preventDefault();
                        setPrefix(crumb.prefix);
                        setSelectedKey(null);
                      }}
                    >
                      {crumb.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="relative w-44">
          <HugeiconsIcon
            icon={Search01Icon}
            className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find objects…"
            aria-label="Find objects"
            className="h-6 border-0 bg-transparent pl-7 text-[11px] shadow-none focus-visible:border-transparent focus-visible:bg-muted/40 focus-visible:ring-0 md:text-[11px] dark:bg-transparent"
          />
        </div>
        <ToolbarTip label={view === "list" ? "Grid view" : "List view"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={view === "list" ? "Grid view" : "List view"}
            onClick={() => setView((v) => (v === "list" ? "grid" : "list"))}
          >
            <HugeiconsIcon
              icon={view === "list" ? ViewIcon : LeftToRightListBulletIcon}
              className="size-3.5"
            />
          </Button>
        </ToolbarTip>
        <ToolbarTip label="Upload into this folder">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            data-slot="file-upload"
            onClick={() => {
              setPendingFiles([]);
              setUploadOpen(true);
            }}
          >
            <HugeiconsIcon icon={FileImportIcon} className="size-3.5" />
            Upload
          </Button>
        </ToolbarTip>
        <ToolbarTip
          label={
            keysToDelete().length > 0
              ? `Delete ${keysToDelete().length} object${keysToDelete().length === 1 ? "" : "s"}`
              : "Select objects to delete"
          }
        >
          <Button
            type="button"
            variant="destructive"
            size={keysToDelete().length > 0 ? "xs" : "icon-xs"}
            disabled={keysToDelete().length === 0}
            onClick={() => setDeleting(keysToDelete())}
            aria-label="Delete selected"
            data-slot="file-delete"
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-3.5" />
            {keysToDelete().length > 0 ? keysToDelete().length : null}
          </Button>
        </ToolbarTip>
        <ToolbarTip label="Reload from the store">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={fetching}
            aria-label="Refresh"
            data-slot="browse-refresh"
            onClick={onRefresh}
          >
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              className={fetching ? "size-3.5 animate-spin" : "size-3.5"}
            />
          </Button>
        </ToolbarTip>
      </div>

      <div
        className={cn("flex min-h-0 flex-1 flex-col", dragging && "bg-sky-500/5")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-slot="file-drop"
      >
        {entries.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6">
            <Empty role="status" data-slot="files-empty">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Folder01Icon} />
                </EmptyMedia>
                <EmptyTitle>
                  {searching ? "No matching objects" : "This folder is empty"}
                </EmptyTitle>
                <EmptyDescription>
                  {searching
                    ? "Try another name or clear the filter."
                    : "Drop files here or upload into this prefix."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : view === "grid" ? (
          <FileGrid
            entries={entries}
            selectedKey={selectedKey}
            checked={checked}
            onOpen={onOpenEntry}
            onToggle={toggleChecked}
          />
        ) : (
          <FileList
            entries={entries}
            selectedKey={selectedKey}
            checked={checked}
            searching={searching}
            onOpen={onOpenEntry}
            onToggle={toggleChecked}
          />
        )}
        <footer className="flex h-8 shrink-0 items-center justify-between border-t border-border/60 px-3 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {listing.folders.length} folder{listing.folders.length === 1 ? "" : "s"}
            <span aria-hidden className="mx-1 text-border">
              ·
            </span>
            {listing.files.length} object{listing.files.length === 1 ? "" : "s"}
            {fetching ? " · refreshing" : ""}
          </span>
          <span>Drop to upload · click a folder to open · click a file to inspect</span>
        </footer>
      </div>

      <FilePreview
        open={selectedKey !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedKey(null);
        }}
        storeRef={store.ref}
        tenant={tenant}
        objectKey={selectedKey}
        sizeBytes={selectedFile?.sizeBytes}
        originalName={selectedFile?.name}
        warnings={selectedFile?.warnings}
        onDelete={
          selectedKey
            ? () => {
                setDeleting([selectedKey]);
              }
            : undefined
        }
      />

      <FileUploadSheet
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        storeRef={store.ref}
        tenant={tenant}
        prefix={prefix}
        existingKeys={keys.map((k) => k.key)}
        pendingFiles={pendingFiles}
      />

      <StoreConfirmSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        phrase="DELETE"
        title={`Delete ${deleting?.length ?? 0} ${deleting?.length === 1 ? "object" : "objects"}`}
        description={`Permanently delete ${deleting?.length ?? 0} object(s) from ${store.ref}. This is not a flow execution.`}
        pending={deleteMutation.isPending}
        error={deleteMutation.isError ? deleteMutation.error.message : null}
        onConfirm={(input) => {
          if (!deleting) return;
          deleteMutation.mutate(
            {
              ref: store.ref,
              ...(tenant ? { tenant } : {}),
              keys: deleting,
              confirmation: input.confirmation,
              reason: input.reason,
            },
            {
              onSuccess: () => {
                setDeleting(null);
                setChecked(new Set());
                setSelectedKey(null);
                onRefresh();
              },
            },
          );
        }}
      />
    </div>
  );
}

function FileList({
  entries,
  selectedKey,
  checked,
  searching,
  onOpen,
  onToggle,
}: {
  readonly entries: readonly FileBrowseEntry[];
  readonly selectedKey: string | null;
  readonly checked: ReadonlySet<string>;
  readonly searching: boolean;
  readonly onOpen: (entry: FileBrowseEntry) => void;
  readonly onToggle: (id: string, next: boolean) => void;
}): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-auto" role="list" aria-label="Objects">
      <div className="sticky top-0 z-10 flex h-7 items-center gap-2 border-b border-border/50 bg-background px-3 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <span className="w-5" />
        <span className="min-w-0 flex-1">Name</span>
        <span className="w-20 text-right">Kind</span>
        <span className="w-16 text-right">Size</span>
      </div>
      {entries.map((entry) => {
        const id = entry.kind === "folder" ? entry.prefix : entry.key;
        const active = entry.kind === "file" && entry.key === selectedKey;
        return (
          <div
            key={id}
            role="listitem"
            data-slot={entry.kind === "folder" ? "file-folder" : "file-object"}
            className={cn(
              "flex h-8 cursor-default items-center gap-2 border-b border-border/30 px-3 text-[12px]",
              active && "bg-sky-500/10",
              !active && "hover:bg-muted/40",
            )}
            onClick={() => onOpen(entry)}
            onDoubleClick={() => onOpen(entry)}
          >
            <span
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={checked.has(id)}
                onCheckedChange={(next) => onToggle(id, next)}
                aria-label={`Select ${entry.name}`}
              />
            </span>
            <FileKindIcon
              kind={entry.kind === "folder" ? "folder" : fileKindFromName(entry.name)}
              well={false}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-foreground">{entry.name}</span>
              {searching && entry.kind === "file" ? (
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  {entry.key}
                </span>
              ) : null}
              {entry.warnings.length > 0 ? (
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="ml-1 inline size-3 text-amber-600 dark:text-amber-400"
                />
              ) : null}
            </span>
            <span className="w-20 text-right text-[11px] text-muted-foreground">
              {entry.kind === "folder" ? "Folder" : fileKindLabel(fileKindFromName(entry.name))}
            </span>
            <span className="w-16 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatByteSize(entry.sizeBytes)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FileGrid({
  entries,
  selectedKey,
  checked,
  onOpen,
  onToggle,
}: {
  readonly entries: readonly FileBrowseEntry[];
  readonly selectedKey: string | null;
  readonly checked: ReadonlySet<string>;
  readonly onOpen: (entry: FileBrowseEntry) => void;
  readonly onToggle: (id: string, next: boolean) => void;
}): JSX.Element {
  return (
    <div
      className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] content-start gap-2 overflow-auto p-3"
      role="list"
      aria-label="Objects"
    >
      {entries.map((entry) => {
        const id = entry.kind === "folder" ? entry.prefix : entry.key;
        const active = entry.kind === "file" && entry.key === selectedKey;
        return (
          <button
            key={id}
            type="button"
            role="listitem"
            data-slot={entry.kind === "folder" ? "file-folder" : "file-object"}
            className={cn(
              "relative flex flex-col items-center gap-2 rounded-lg border px-2 py-3 text-center",
              active
                ? "border-sky-500/40 bg-sky-500/10"
                : "border-border/50 hover:border-border hover:bg-muted/40",
            )}
            onClick={() => onOpen(entry)}
            onDoubleClick={() => onOpen(entry)}
          >
            <span
              className="absolute top-1.5 left-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={checked.has(id)}
                onCheckedChange={(next) => onToggle(id, next)}
                aria-label={`Select ${entry.name}`}
              />
            </span>
            <FileKindIcon
              kind={entry.kind === "folder" ? "folder" : fileKindFromName(entry.name)}
              className="size-10 rounded-lg [&_svg]:size-5"
            />
            <span className="line-clamp-2 w-full text-[11px] leading-4 text-foreground">
              {entry.name}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {entry.kind === "folder"
                ? `${entry.objectCount} objects`
                : formatByteSize(entry.sizeBytes)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
