/**
 * Audited reveal control for a masked PII SQL cell.
 */

import { useState, type JSX } from "react";
import { ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStoreReveal } from "../data/use-store-reveal.ts";

/** Props for {@link RevealCell}. */
export interface RevealCellProps {
  readonly refName: string;
  readonly child: string;
  readonly tenant?: string;
  readonly rowId: string;
  readonly column: string;
  readonly maskedValue: unknown;
}

/**
 * Show masked value with an audited Reveal button; replace with cleartext after success.
 *
 * @param props - Row/column identity + masked display value
 */
export function RevealCell({
  refName,
  child,
  tenant,
  rowId,
  column,
  maskedValue,
}: RevealCellProps): JSX.Element {
  const reveal = useStoreReveal();
  const [clear, setClear] = useState<{ readonly value: unknown } | null>(null);
  const shown = clear !== null ? clear.value : maskedValue;

  return (
    <span className="inline-flex max-w-full items-center gap-1.5" data-slot="reveal-cell">
      <span className="min-w-0 truncate font-mono text-[11px]">{formatCell(shown)}</span>
      {clear === null ? (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Button
                {...props}
                type="button"
                variant="ghost"
                size="xs"
                className="h-5 shrink-0 gap-0.5 px-1 text-[10px]"
                disabled={reveal.isPending || rowId.length === 0}
                aria-label={`Reveal ${column}`}
                data-slot="reveal-button"
                onClick={() => {
                  reveal.mutate(
                    {
                      ref: refName,
                      child,
                      ...(tenant !== undefined ? { tenant } : {}),
                      id: rowId,
                      column,
                    },
                    {
                      onSuccess: (data) => {
                        setClear({ value: data.value });
                      },
                    },
                  );
                }}
              >
                <HugeiconsIcon icon={ViewIcon} className="size-3" aria-hidden />
                Reveal
              </Button>
            )}
          />
          <TooltipContent side="top" className="text-[11px]">
            Audited PII reveal — logged server-side
          </TooltipContent>
        </Tooltip>
      ) : null}
      {reveal.isError ? (
        <span className="text-[10px] text-destructive" role="status">
          {reveal.error.message}
        </span>
      ) : null}
    </span>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
