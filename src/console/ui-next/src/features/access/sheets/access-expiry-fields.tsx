/**
 * Expiry presets shared by Access create / edit / refresh.
 */

import type { JSX } from "react";
import { Input } from "@/components/ui/input";
import {
  SHEET_CONTROL,
  SheetChoice,
  SheetChoiceRow,
  SheetField,
} from "@/components/ui/sheet-form.tsx";
import { cn } from "@/lib/utils.ts";
import type { AccessExpiryChoice } from "../lib/format-when.ts";

/** Props for {@link AccessExpiryFields}. */
export interface AccessExpiryFieldsProps {
  readonly expires: AccessExpiryChoice;
  readonly customExpires: string;
  readonly onExpires: (choice: AccessExpiryChoice) => void;
  readonly onCustomExpires: (raw: string) => void;
}

/**
 * Never / 30d / 90d / custom duration row.
 *
 * @param props - Choice + custom duration
 */
export function AccessExpiryFields({
  expires,
  customExpires,
  onExpires,
  onCustomExpires,
}: AccessExpiryFieldsProps): JSX.Element {
  return (
    <>
      <SheetChoiceRow label="Expires">
        <SheetChoice active={expires === "never"} onClick={() => onExpires("never")}>
          never
        </SheetChoice>
        <SheetChoice active={expires === "30d"} onClick={() => onExpires("30d")}>
          30d
        </SheetChoice>
        <SheetChoice active={expires === "90d"} onClick={() => onExpires("90d")}>
          90d
        </SheetChoice>
        <SheetChoice active={expires === "custom"} onClick={() => onExpires("custom")}>
          custom
        </SheetChoice>
      </SheetChoiceRow>
      {expires === "custom" ? (
        <SheetField label="Duration" hint="7d · 12h · 30m">
          <Input
            value={customExpires}
            onChange={(e) => onCustomExpires(e.target.value)}
            placeholder="7d"
            autoComplete="off"
            aria-label="Custom expiry duration"
            flat
            className={cn(SHEET_CONTROL, "font-mono")}
          />
        </SheetField>
      ) : null}
    </>
  );
}
