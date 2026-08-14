/**
 * Files object sheet — preview + metadata, same chrome as SQL/KV row detail.
 */

import { useEffect, useMemo, type JSX } from "react";
import { Alert02Icon, Copy01Icon, Delete02Icon, FileExportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils.ts";
import { formatByteSize } from "../lib/kv-meta.ts";
import { bytesToArrayBuffer, decodeFileBody, downloadFileBytes } from "../lib/files-body.ts";
import {
  fileExtension,
  fileKindFromName,
  fileKindIsText,
  fileKindLabel,
  fileNameFromKey,
  filePreviewMode,
  formatFilePreviewText,
  type FileKind,
  type FilePreviewMode,
} from "../lib/files-meta.ts";
import { useStoreFile } from "../data/use-store-files.ts";
import { FileKindIcon } from "./file-kind-icon.tsx";

/** Props for {@link FilePreview}. */
export interface FilePreviewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly tenant?: string | null;
  readonly objectKey: string | null;
  readonly sizeBytes?: number;
  readonly originalName?: string;
  readonly warnings?: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  readonly onDelete?: () => void;
}

/**
 * Right-side sheet for the selected files object.
 *
 * @param props - Store identity + selected key
 */
export function FilePreview({
  open,
  onOpenChange,
  storeRef,
  tenant,
  objectKey,
  sizeBytes,
  originalName,
  warnings = [],
  onDelete,
}: FilePreviewProps): JSX.Element {
  const input = useMemo(() => {
    if (!objectKey) return null;
    return {
      ref: storeRef,
      key: objectKey,
      ...(tenant ? { tenant } : {}),
    };
  }, [storeRef, objectKey, tenant]);

  const object = useStoreFile(input, open && objectKey !== null);
  const kind = objectKey ? fileKindFromName(objectKey) : null;
  const name = objectKey ? fileNameFromKey(objectKey) : null;

  const bytes = useMemo(() => {
    if (!object.data) return null;
    return decodeFileBody(object.data.encoding, object.data.body);
  }, [object.data]);

  const mode = kind ? filePreviewMode(kind) : "none";
  const objectUrl = useMemo(() => {
    if (!object.data || !bytes || object.data.truncated) return null;
    if (mode !== "image" && mode !== "pdf" && mode !== "video" && mode !== "audio") return null;
    const blob = new Blob([bytesToArrayBuffer(bytes)], { type: object.data.contentType });
    return URL.createObjectURL(blob);
  }, [object.data, bytes, mode]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  if (!objectKey || !kind || !name) return <></>;

  const text =
    object.data && fileKindIsText(kind) && object.data.encoding === "utf8"
      ? object.data.body
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 sm:max-w-lg"
        data-slot="file-preview"
      >
        <SheetHeader className="gap-2 border-b border-border/50">
          <div className="flex items-start gap-2.5 pr-8">
            <FileKindIcon kind={kind} />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-sm">
                {object.data?.originalName ?? originalName ?? name}
              </SheetTitle>
              <SheetDescription className="font-mono text-[11px]">
                {fileKindLabel(kind)}
                <span aria-hidden className="mx-1 text-border">
                  ·
                </span>
                {formatByteSize(object.data?.sizeBytes ?? sizeBytes ?? 0)}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {object.isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : object.isError ? (
            <p className="px-4 py-4 text-[11px] text-destructive">{object.error.message}</p>
          ) : (
            <div className="flex flex-col">
              <PreviewSurface
                kind={kind}
                name={name}
                mode={mode}
                text={text}
                objectUrl={objectUrl}
                truncated={object.data?.truncated ?? false}
              />
              <dl className="flex flex-col gap-2 border-t border-border/50 px-4 py-3 text-[11px]">
                {object.data?.originalName ?? originalName ? (
                  <MetaRow label="Original name" value={object.data?.originalName ?? originalName ?? ""} />
                ) : null}
                <MetaRow label="Key" mono value={objectKey} />
                <MetaRow label="Type" value={object.data?.contentType ?? "—"} />
                <MetaRow
                  label="Size"
                  value={formatByteSize(object.data?.sizeBytes ?? sizeBytes ?? 0)}
                />
              </dl>
              {warnings.length > 0 || (object.data?.warnings.length ?? 0) > 0 ? (
                <ul className="flex flex-col gap-1 border-t border-amber-500/20 bg-amber-500/5 px-4 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                  {(object.data?.warnings ?? warnings).map((w) => (
                    <li key={w.code} className="flex items-start gap-1.5">
                      <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3 shrink-0" />
                      {w.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 px-4 py-2.5">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!bytes || object.data?.truncated}
              onClick={() => {
                if (!bytes || !object.data) return;
                downloadFileBytes(name, bytes, object.data.contentType);
              }}
            >
              <HugeiconsIcon icon={FileExportIcon} className="size-3.5" aria-hidden />
              Download
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Copy key"
              onClick={() => void navigator.clipboard.writeText(objectKey)}
            >
              <HugeiconsIcon icon={Copy01Icon} />
            </Button>
          </div>
          {onDelete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDelete}
              data-slot="file-preview-delete"
            >
              <HugeiconsIcon icon={Delete02Icon} className="size-3.5" aria-hidden />
              Delete
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PreviewSurface({
  kind,
  name,
  mode,
  text,
  objectUrl,
  truncated,
}: {
  readonly kind: FileKind;
  readonly name: string;
  readonly mode: FilePreviewMode;
  readonly text: string | null;
  readonly objectUrl: string | null;
  readonly truncated: boolean;
}): JSX.Element {
  if (truncated && mode !== "text") {
    return (
      <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
        {fileKindLabel(kind)} is larger than the preview window — download to open.
      </p>
    );
  }
  if (mode === "image" && objectUrl) {
    return (
      <div className="flex items-center justify-center bg-[repeating-conic-gradient(var(--border)_0%_25%,transparent_0%_50%)] bg-size-[12px_12px] p-4">
        <img
          src={objectUrl}
          alt=""
          className="max-h-72 max-w-full rounded-md border border-border/60 bg-background object-contain"
        />
      </div>
    );
  }
  if (mode === "pdf" && objectUrl) {
    return (
      <iframe
        title={name}
        src={objectUrl}
        className="h-80 w-full border-0 bg-background"
      />
    );
  }
  if (mode === "video" && objectUrl) {
    return (
      <div className="bg-black p-2">
        <video src={objectUrl} controls className="max-h-72 w-full" />
      </div>
    );
  }
  if (mode === "audio" && objectUrl) {
    return (
      <div className="px-4 py-6">
        <audio src={objectUrl} controls className="w-full" />
      </div>
    );
  }
  if (mode === "text" && text !== null) {
    const ext = fileExtension(name);
    if (ext === "csv" || ext === "tsv") {
      return <DelimitedPreview text={text} delimiter={ext === "tsv" ? "\t" : ","} />;
    }
    return (
      <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[11px] leading-4 text-foreground/80">
        {formatFilePreviewText(text, name)}
        {truncated ? "\n… truncated" : ""}
      </pre>
    );
  }
  return (
    <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
      {fileKindLabel(kind)} — download to open
      {truncated ? " (preview truncated)" : ""}.
    </p>
  );
}

function DelimitedPreview({
  text,
  delimiter,
}: {
  readonly text: string;
  readonly delimiter: string;
}): JSX.Element {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(0, 40)
    .map((line) => line.split(delimiter));
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-left font-mono text-[10px]">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/40">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1 whitespace-nowrap text-foreground/80">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("break-all text-foreground/80", mono && "font-mono text-[10px]")}>
        {value}
      </dd>
    </div>
  );
}
