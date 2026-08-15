/**
 * Call API PII toggle — same Include PII control as Store Query.
 */

import { SecurityCheckIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { cn } from "@/lib/utils";

/** Props for {@link CallPiiButton}. */
export interface CallPiiButtonProps {
  /** True when classified fields stay redacted. */
  readonly piiMasked: boolean;
  /** Disable while an invoke is in flight. */
  readonly disabled?: boolean;
  /** Toggle handler. */
  readonly onToggle: () => void;
}

/**
 * Toolbar control: include audited cleartext PII on the next (or re-run) invoke.
 *
 * @param props - Masked state + toggle
 */
export function CallPiiButton({ piiMasked, disabled, onToggle }: CallPiiButtonProps): JSX.Element {
  return (
    <ToolbarTip
      label={
        piiMasked
          ? "PII hidden. Click to include cleartext (audited)."
          : "PII included. Click to remask."
      }
    >
      <Button
        type="button"
        variant={piiMasked ? "ghost" : "secondary"}
        size="sm"
        disabled={disabled}
        className={cn(
          "h-8 rounded-none px-2 text-[11px]",
          !piiMasked && "text-amber-800 dark:text-amber-300",
        )}
        aria-pressed={!piiMasked}
        aria-label={piiMasked ? "Include PII: disabled" : "Include PII: enabled"}
        onClick={onToggle}
        data-slot="call-api-pii"
      >
        <HugeiconsIcon icon={SecurityCheckIcon} data-icon="inline-start" className="size-3.5" />
        PII
      </Button>
    </ToolbarTip>
  );
}
