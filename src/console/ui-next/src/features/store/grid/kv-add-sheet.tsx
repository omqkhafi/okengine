/**
 * Add a KV key — set key + JSON value + optional TTL.
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
import { useStoreEdit } from "../data/use-store-edit.ts";
import { parseInspectableJsonText } from "../lib/json-value.ts";
import { parseKvTtlDraft } from "../lib/kv-meta.ts";

/** Props for {@link KvAddSheet}. */
export interface KvAddSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly storeRef: string;
  readonly childName: string;
  readonly tenant?: string | null;
  readonly existingKeys: readonly string[];
}

/**
 * Right-side form to `set` a new key in the current KV namespace.
 *
 * @param props - Store identity + existing keys on this page
 */
export function KvAddSheet({
  open,
  onOpenChange,
  storeRef,
  childName,
  tenant,
  existingKeys,
}: KvAddSheetProps): JSX.Element {
  const { mutate, isPending, reset } = useStoreEdit();
  const [key, setKey] = useState(`${childName}:`);
  const [json, setJson] = useState("{\n  \n}");
  const [ttl, setTtl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKey(`${childName}:`);
    setJson("{\n  \n}");
    setTtl("");
    setError(null);
    reset();
  }, [open, childName, reset]);

  const submit = () => {
    const nextKey = key.trim();
    if (nextKey.length === 0 || nextKey.endsWith(":")) {
      setError("Key needs a name after the prefix");
      return;
    }
    if (existingKeys.includes(nextKey)) {
      setError("That key is already on this page");
      return;
    }
    const parsed = parseInspectableJsonText(json);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const ttlDraft = parseKvTtlDraft(ttl);
    if (ttlDraft === undefined) {
      setError("TTL must be a duration like 30m, 1h, or empty");
      return;
    }
    setError(null);
    mutate(
      {
        ref: storeRef,
        key: nextKey,
        ...(tenant ? { tenant } : {}),
        patch: {
          value: parsed.value,
          ...(ttlDraft !== null ? { ttl: ttlDraft } : {}),
        },
        commit: true,
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
        data-slot="kv-add-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Add key</SheetTitle>
          <SheetDescription className="font-mono text-[11px]">{storeRef}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SheetField label="Key">
            <Input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-label="Key"
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
              autoFocus
            />
          </SheetField>
          <SheetField label="Value">
            <textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
              aria-label="JSON value"
              spellCheck={false}
              className="min-h-40 w-full flex-1 resize-y rounded-none border-0 bg-transparent px-4 py-1.5 font-mono text-[11px] leading-5 outline-none"
            />
          </SheetField>
          <SheetField label="TTL">
            <Input
              value={ttl}
              onChange={(event) => setTtl(event.target.value)}
              aria-label="TTL"
              placeholder="30m"
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
            />
          </SheetField>
          {error ? <SheetError slot="kv-add-error">{error}</SheetError> : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={isPending}
            onClick={submit}
            data-slot="kv-add-submit"
          >
            {isPending ? "Adding…" : "Add key"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
