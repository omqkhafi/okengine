/**
 * Add a vault.secret or vault.config from Console.
 */

import { useEffect, useState, type JSX } from "react";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetChoice,
  SheetChoiceRow,
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
import {
  cancelVaultWrite,
  confirmVaultWrite,
  openVaultWriteReview,
  type VaultWriteReview,
} from "../lib/write-review.ts";
import { VaultWriteReviewDialog } from "./vault-write-review-dialog.tsx";

/** Props for {@link VaultCreateSheet}. */
export interface VaultCreateSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onSubmit: (input: {
    readonly name: string;
    readonly value: string;
    readonly kind: "secret" | "config";
    readonly description: string;
    readonly rotate: string;
  }) => void;
}

/**
 * Create sheet — name + kind + value. Secrets stay write-only.
 *
 * @param props - Open + submit
 */
export function VaultCreateSheet({
  open,
  onOpenChange,
  pending = false,
  error,
  onSubmit,
}: VaultCreateSheetProps): JSX.Element {
  const [kind, setKind] = useState<"secret" | "config">("secret");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rotate, setRotate] = useState("90d");
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [review, setReview] = useState<VaultWriteReview | null>(null);

  useEffect(() => {
    if (!open) {
      setKind("secret");
      setName("");
      setDescription("");
      setRotate("90d");
      setValue("");
      setLocalError(null);
      setReview(null);
    }
  }, [open]);

  const ready = name.trim().length > 0 && value.trim().length > 0 && !pending;

  const requestReview = async (): Promise<void> => {
    const next = await openVaultWriteReview({
      action: "create",
      name: name.trim(),
      value,
      sensitive: kind === "secret",
      kind,
      description: description.trim(),
      rotate: kind === "secret" ? rotate : "never",
    });
    if ("error" in next) {
      setLocalError(next.error);
      return;
    }
    setLocalError(null);
    setReview(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="gap-0 p-0 data-[side=right]:sm:max-w-md"
        data-slot="vault-create-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border/50">
          <SheetTitle className="text-sm">Add vault contract</SheetTitle>
          <SheetDescription className="text-[11px]">
            {kind === "secret"
              ? "Writes the value and lists the contract here. Promote it to vault.secret in source when a Flow should read it."
              : "vault.config — shown in the clear on the Config band after submit."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SheetChoiceRow label="Kind">
            <SheetChoice active={kind === "secret"} onClick={() => setKind("secret")}>
              secret
            </SheetChoice>
            <SheetChoice active={kind === "config"} onClick={() => setKind("config")}>
              config
            </SheetChoice>
          </SheetChoiceRow>
          <SheetField label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="STRIPE_KEY"
              autoComplete="off"
              aria-label="Contract name"
              flat
              className={cn(SHEET_CONTROL, "font-mono")}
            />
          </SheetField>
          <SheetField label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional title"
              autoComplete="off"
              aria-label="Description"
              flat
              className={SHEET_CONTROL}
            />
          </SheetField>
          {kind === "secret" ? (
            <SheetChoiceRow label="Rotate">
              <SheetChoice active={rotate === "90d"} onClick={() => setRotate("90d")}>
                90d
              </SheetChoice>
              <SheetChoice active={rotate === "never"} onClick={() => setRotate("never")}>
                no rotate
              </SheetChoice>
            </SheetChoiceRow>
          ) : null}
          <SheetField label="Value">
            <Input
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === "secret" ? "Paste the secret" : "Public value"}
              aria-label="New vault value"
              flat
              className={SHEET_CONTROL}
            />
          </SheetField>
          {localError || error ? (
            <SheetError slot="vault-create-error">{localError ?? error}</SheetError>
          ) : null}
        </div>

        <SheetFooter>
          <SheetFooterButton split onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </SheetFooterButton>
          <SheetFooterButton
            variant="default"
            disabled={!ready}
            onClick={() => {
              void requestReview();
            }}
            data-slot="vault-create-submit"
          >
            {kind === "secret" ? "Review secret" : "Review config"}
          </SheetFooterButton>
        </SheetFooter>
      </SheetContent>

      <VaultWriteReviewDialog
        review={review}
        pending={pending}
        onCancel={() => setReview(cancelVaultWrite())}
        onConfirm={() => {
          confirmVaultWrite(review, (next) => {
            onSubmit({
              name: next.commit.name,
              value: next.commit.value,
              kind: next.commit.kind,
              description: next.commit.description,
              rotate: next.commit.rotate,
            });
          });
        }}
      />
    </Sheet>
  );
}
