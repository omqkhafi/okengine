/**
 * Allow list (add one) + split rate fields — create / edit.
 */

import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type JSX, type KeyboardEvent } from "react";
import {
  EXPLORER_COUNT_CLASS,
  EXPLORER_ICON_BUTTON_BARE_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  EXPLORER_STRIP_TOKEN_SELECTED_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Input } from "@/components/ui/input";
import { SHEET_CONTROL } from "@/components/ui/sheet-form.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils.ts";
import {
  ACCESS_RATE_UNIT_LABELS,
  ACCESS_RATE_UNITS,
  classifyAccessAllowEntry,
  parseAccessAllowlist,
  type AccessRateUnit,
} from "../lib/format-when.ts";

/** Props for {@link AccessAllowFields}. */
export interface AccessAllowFieldsProps {
  readonly entries: readonly string[];
  readonly rateMax: string;
  readonly rateCount: string;
  readonly rateUnit: AccessRateUnit;
  readonly onEntries: (entries: readonly string[]) => void;
  readonly onRateMax: (raw: string) => void;
  readonly onRateCount: (raw: string) => void;
  readonly onRateUnit: (unit: AccessRateUnit) => void;
}

/**
 * Add-one allow list and max / window rate.
 *
 * @param props - Entries + rate parts
 */
export function AccessAllowFields({
  entries,
  rateMax,
  rateCount,
  rateUnit,
  onEntries,
  onRateMax,
  onRateCount,
  onRateUnit,
}: AccessAllowFieldsProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const parsed = parseAccessAllowlist(draft);
  const draftInvalid = draft.trim().length > 0 && parsed.length === 0;

  const addDraft = () => {
    if (parsed.length === 0) return;
    const seen = new Set(entries);
    const merged = [...entries];
    for (const entry of parsed) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      merged.push(entry);
    }
    onEntries(merged);
    setDraft("");
  };

  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addDraft();
  };

  return (
    <>
      <div className="border-b border-border/50" data-slot="access-allow-field">
        <div className="flex items-stretch">
          <p className="flex h-8 w-[5.5rem] shrink-0 items-center px-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Allow
          </p>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKey}
            placeholder="203.0.113.4 or ci.example.com"
            autoComplete="off"
            aria-label="Add allow entry"
            aria-invalid={draftInvalid}
            flat
            className={cn(SHEET_CONTROL, "min-w-0 flex-1 font-mono")}
          />
          {entries.length > 0 ? (
            <span className={cn(EXPLORER_COUNT_CLASS, "flex h-8 items-center pr-2")}>
              {entries.length}
            </span>
          ) : null}
          <button
            type="button"
            className={cn(EXPLORER_ICON_BUTTON_CLASS, "h-8")}
            aria-label="Add allow entry"
            disabled={parsed.length === 0}
            onClick={addDraft}
          >
            <HugeiconsIcon icon={PlusSignIcon} className="size-3.5" aria-hidden />
          </button>
        </div>
        {draftInvalid ? (
          <p className="border-t border-border/50 px-4 py-2 text-[11px] text-destructive">
            Need an IP or host — 203.0.113.4, ::1, localhost, or ci.example.com.
          </p>
        ) : entries.length === 0 ? (
          <p className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
            Any client. Add an IP or host.
          </p>
        ) : (
          <div role="list" aria-label="Allow list">
            {entries.map((entry) => {
              const kind = classifyAccessAllowEntry(entry);
              return (
                <div
                  key={entry}
                  role="listitem"
                  data-slot="access-allow-entry"
                  data-kind={kind ?? "invalid"}
                  className={cn(EXPLORER_ROW_CLASS, "last:border-b-0")}
                >
                  <span
                    className={cn(
                      SECTION_HEAD_CLASS,
                      "w-[5.5rem] shrink-0 px-1.5",
                      kind == null && "text-destructive",
                    )}
                  >
                    {kind === "ip" ? "IP" : kind === "host" ? "Host" : "Bad"}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate font-mono text-[11px]",
                      kind == null && "text-destructive",
                    )}
                  >
                    {entry}
                  </span>
                  <button
                    type="button"
                    className={cn(
                      EXPLORER_ICON_BUTTON_BARE_CLASS,
                      "ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    )}
                    aria-label={`Remove ${entry}`}
                    onClick={() => onEntries(entries.filter((item) => item !== entry))}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} className="size-3" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-stretch border-b border-border/50" data-slot="access-rate-field">
        <p className="flex h-8 w-[5.5rem] shrink-0 items-center px-4 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Rate
        </p>
        <label className="flex min-w-0 flex-1 items-stretch border-r border-border/50">
          <span className="flex h-8 shrink-0 items-center pl-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Max
          </span>
          <Input
            value={rateMax}
            onChange={(e) => onRateMax(e.target.value)}
            placeholder="none"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Rate max"
            flat
            className={cn(SHEET_CONTROL, "min-w-0 flex-1 px-2 font-mono tabular-nums")}
          />
        </label>
        <label className="flex min-w-0 flex-1 items-stretch">
          <span className="flex h-8 shrink-0 items-center pl-2 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Every
          </span>
          <Input
            value={rateCount}
            onChange={(e) => onRateCount(e.target.value)}
            placeholder="1"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Rate window"
            flat
            className={cn(SHEET_CONTROL, "min-w-0 flex-1 px-2 font-mono tabular-nums")}
          />
        </label>
        <div className="flex h-8 shrink-0 items-stretch" role="group" aria-label="Rate unit">
          {ACCESS_RATE_UNITS.map((unit) => (
            <Tooltip key={unit}>
              <TooltipTrigger
                render={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-pressed={rateUnit === unit}
                    aria-label={ACCESS_RATE_UNIT_LABELS[unit]}
                    onClick={(event) => {
                      props.onClick?.(event);
                      onRateUnit(unit);
                    }}
                    className={cn(
                      EXPLORER_STRIP_TOKEN_CLASS,
                      "h-8 px-1.5 font-mono font-semibold",
                      rateUnit === unit
                        ? EXPLORER_STRIP_TOKEN_SELECTED_CLASS
                        : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
                    )}
                  >
                    {unit}
                  </button>
                )}
              />
              <TooltipContent side="bottom" className="text-[11px]">
                {ACCESS_RATE_UNIT_LABELS[unit]}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </>
  );
}
