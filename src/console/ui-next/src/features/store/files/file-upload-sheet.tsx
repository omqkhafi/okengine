/**
 * Upload an object into the current files prefix.
 */

import { useEffect, useState, type JSX } from "react";
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
import { cn } from "@/lib/utils.ts";
import { bytesToBase64 } from "../lib/files-body.ts";
import { fileNameFromKey, safeFileObjectKey } from "../lib/files-meta.ts";
import { useStoreFilePut } from "../data/use-store-files.ts";

function newObjectKeyId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Props for {@link FileUploadSheet}. */
export interface FileUploadSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly tenant?: string | null;
  readonly prefix: string;
  readonly existingKeys: readonly string[];
  /** Dropped files prefill the form. */
  readonly pendingFiles?: readonly File[];
}

/**
 * Right-side form to `put` a new object in the current folder.
 *
 * @param props - Store identity + current prefix
 */
export function FileUploadSheet({
  open,
  onOpenChange,
  storeRef,
  tenant,
  prefix,
  existingKeys,
  pendingFiles = [],
}: FileUploadSheetProps): JSX.Element {
  const { mutate, isPending, reset } = useStoreFilePut();
  const [originalName, setOriginalName] = useState("");
  const [keyId, setKeyId] = useState("");
  const [key, setKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const first = pendingFiles[0] ?? null;
    setFile(first);
    const name = first ? fileNameFromKey(first.name) : "";
    const id = newObjectKeyId();
    setKeyId(id);
    setOriginalName(name);
    setKey(name ? safeFileObjectKey(name, prefix, id) : "");
    setError(null);
    reset();
  }, [open, prefix, pendingFiles, reset]);

  const submit = async () => {
    const name = originalName.trim();
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    if (name.length === 0) {
      setError("Original name is required");
      return;
    }
    const nextKey = key.trim().length > 0 ? key.trim() : safeFileObjectKey(name, prefix);
    if (existingKeys.includes(nextKey)) {
      setError("That key is already in this bucket");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setError(null);
    mutate(
      {
        ref: storeRef,
        key: nextKey,
        ...(tenant ? { tenant } : {}),
        body: bytesToBase64(bytes),
        encoding: "base64",
        originalName: name,
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="file-upload-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Upload object</SheetTitle>
          <SheetDescription className="font-mono text-[11px]">{storeRef}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SheetField label="Original name" hint="Shown in the browser. Unicode is fine.">
            <Input
              value={originalName}
              onChange={(event) => {
                const name = event.target.value;
                setOriginalName(name);
                const id = keyId.length > 0 ? keyId : newObjectKeyId();
                if (keyId.length === 0) setKeyId(id);
                setKey(name.trim().length > 0 ? safeFileObjectKey(name.trim(), prefix, id) : "");
              }}
              aria-label="Original name"
              flat
              className={SHEET_CONTROL}
              autoFocus
            />
          </SheetField>
          <SheetField label="Object key" hint="URL-safe. Generated from the original name.">
            <Input
              value={key}
              readOnly
              aria-label="Object key"
              flat
              className={cn(SHEET_CONTROL, "font-mono text-muted-foreground")}
            />
          </SheetField>
          <SheetField
            label="File"
            hint={file ? `${fileNameFromKey(file.name)} · ${file.size} B` : undefined}
          >
            <Input
              type="file"
              aria-label="File"
              flat
              className={cn(SHEET_CONTROL, "pt-1.5")}
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
                if (!next) return;
                const name = fileNameFromKey(next.name);
                const id = keyId.length > 0 ? keyId : newObjectKeyId();
                if (keyId.length === 0) setKeyId(id);
                setOriginalName(name);
                setKey(safeFileObjectKey(name, prefix, id));
              }}
            />
          </SheetField>
          {error ? <SheetError slot="file-upload-error">{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={isPending}
            onClick={() => void submit()}
            data-slot="file-upload-submit"
          >
            {isPending ? "Uploading…" : "Upload"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
