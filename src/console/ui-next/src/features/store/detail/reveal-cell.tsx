/**
 * Audited reveal control for a masked PII SQL cell.
 */

import { useState, type JSX } from "react";
import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
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
 * Show a compact mask glyph with an audited Reveal control; replace with cleartext after success.
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

  if (clear !== null) {
    return (
      <span className="inline-flex max-w-full items-center gap-1" data-slot="reveal-cell">
        <span className="min-w-0 truncate font-mono text-[11px]">{formatCell(clear.value)}</span>
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <Button
                {...props}
                type="button"
                variant="ghost"
                size="icon-xs"
                className="size-5 text-muted-foreground"
                aria-label={`Hide ${column}`}
                data-slot="hide-button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClick?.(event);
                  setClear(null);
                }}
              >
                <HugeiconsIcon icon={ViewOffSlashIcon} className="size-3" aria-hidden />
              </Button>
            )}
          />
          <TooltipContent side="top" className="text-[11px]">
            Hide cleartext
          </TooltipContent>
        </Tooltip>
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1" data-slot="reveal-cell">
      <span
        className="rounded-md bg-muted/70 px-1.5 py-px font-mono text-[10px] tracking-[0.22em] text-muted-foreground"
        aria-label="Masked"
      >
        ••••••
      </span>
      <Tooltip>
        <TooltipTrigger
          render={(props) => (
            <Button
              {...props}
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-5 text-muted-foreground"
              disabled={reveal.isPending || rowId.length === 0}
              aria-label={`Reveal ${column}`}
              data-slot="reveal-button"
              onClick={(event) => {
                event.stopPropagation();
                props.onClick?.(event);
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
            </Button>
          )}
        />
        <TooltipContent side="top" className="text-[11px]">
          Audited PII reveal — logged server-side
        </TooltipContent>
      </Tooltip>
      {reveal.isError ? (
        <span className="text-[10px] text-destructive" role="status">
          {reveal.error.message}
        </span>
      ) : null}
      <span className="sr-only">{formatCell(maskedValue)}</span>
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
