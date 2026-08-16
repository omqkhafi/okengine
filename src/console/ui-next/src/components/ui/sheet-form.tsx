/**
 * Flat, full-bleed form primitives for Console sheets.
 */

import { Children, type ComponentProps, type JSX, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils.ts";

/** Borderless control inside a {@link SheetField}. */
export const SHEET_CONTROL =
  "h-8 rounded-none border-0 bg-transparent px-4 text-[12px] shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";

/** Search field with a leading icon inset. */
export const SHEET_SEARCH =
  "h-8 rounded-none border-0 bg-transparent pr-4 pl-9 text-[12px] shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent";

/** Flush footer action. */
export const SHEET_FOOTER_BTN =
  "h-11 flex-1 rounded-none border-0 shadow-none focus-visible:ring-0";

/** Props for {@link SheetField}. */
export interface SheetFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly className?: string;
  /** Pair inside {@link SheetPair}: start draws the mid rule. */
  readonly split?: "start" | "end";
  /** One-line label + hint, tighter padding — Call API grid. */
  readonly dense?: boolean;
  readonly children: ReactNode;
}

/**
 * Label above a full-bleed control, separated by the sheet row rule.
 *
 * @param props - Field label + control
 */
export function SheetField({
  label,
  hint,
  className,
  split,
  dense = false,
  children,
}: SheetFieldProps): JSX.Element {
  return (
    <label
      className={cn(
        "block min-w-0 border-b border-border/50",
        split === "start" && "border-r border-b-0",
        split === "end" && "border-b-0",
        className,
      )}
    >
      {dense ? (
        <span className="flex items-baseline justify-between gap-2 px-2 pt-1">
          <span className="min-w-0 truncate text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {label}
          </span>
          {hint ? (
            <span className="min-w-0 truncate font-mono text-[9px] text-muted-foreground/70">
              {hint}
            </span>
          ) : null}
        </span>
      ) : (
        <>
          <span className="block truncate px-3 pt-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {label}
          </span>
          {hint ? (
            <span className="block truncate px-3 font-mono text-[10px] text-muted-foreground/70">
              {hint}
            </span>
          ) : null}
        </>
      )}
      {children}
    </label>
  );
}

/** Props for {@link SheetSwitchRow}. */
export interface SheetSwitchRowProps {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Full-width row with a label and a trailing switch.
 *
 * @param props - Row label + switch
 */
export function SheetSwitchRow({ label, className, children }: SheetSwitchRowProps): JSX.Element {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3",
        className,
      )}
    >
      <span className="text-[12px] text-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Props for {@link SheetTextToggle}. */
export interface SheetTextToggleProps extends ComponentProps<"button"> {
  readonly active: boolean;
  readonly extraCount?: number;
}

/**
 * Borderless text toggle (Advanced, Templates).
 *
 * @param props - Active state + optional extra count
 */
export function SheetTextToggle({
  active,
  extraCount = 0,
  className,
  children,
  type = "button",
  ...props
}: SheetTextToggleProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center gap-1 rounded-none border-0 bg-transparent px-2 py-1 text-[10px] font-semibold tracking-[0.08em] uppercase shadow-none transition-colors hover:bg-muted/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {extraCount > 0 ? (
        <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/10 px-1 text-[9px] font-semibold tabular-nums">
          {extraCount}
        </span>
      ) : null}
    </button>
  );
}

/** Props for {@link SheetChoiceRow}. */
export interface SheetChoiceRowProps {
  readonly label: string;
  readonly hint?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * One row: label on the left, {@link SheetChoice} chips on the right.
 *
 * @param props - Row label + choices + optional hint
 */
export function SheetChoiceRow({
  label,
  hint,
  className,
  children,
}: SheetChoiceRowProps): JSX.Element {
  return (
    <div className={cn("border-b border-border/50", className)}>
      <div className="flex items-center gap-3 px-4">
        <p className="shrink-0 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {label}
        </p>
        <div className="flex min-w-0 flex-1 items-stretch" role="group" aria-label={label}>
          {children}
        </div>
      </div>
      {hint ? <p className="px-4 pb-2 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Props for {@link SheetChoice}. */
export interface SheetChoiceProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: string;
}

/**
 * One option in a {@link SheetChoiceRow}.
 *
 * @param props - Active state + label
 */
export function SheetChoice({ active, onClick, children }: SheetChoiceProps): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-0 flex-1 items-center justify-center px-2 font-mono text-[10px] font-semibold outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Props for {@link SheetFooterButton}. */
export interface SheetFooterButtonProps extends ComponentProps<typeof Button> {
  /** Draw a divider on the trailing edge (every button except the last). */
  readonly split?: boolean;
}

/**
 * Full-bleed footer action. Pair inside {@link SheetFooter}.
 *
 * @param props - Button props + optional split rule
 */
export function SheetFooterButton({
  split = false,
  className,
  variant = "ghost",
  ...props
}: SheetFooterButtonProps): JSX.Element {
  return (
    <Button
      variant={variant}
      className={cn(SHEET_FOOTER_BTN, split && "border-r border-border/50", className)}
      {...props}
    />
  );
}

/** Props for {@link SheetError}. */
export interface SheetErrorProps {
  readonly children: ReactNode;
  readonly slot?: string;
}

/**
 * Destructive message on a sheet row rule.
 *
 * @param props - Message + optional data-slot
 */
export function SheetError({ children, slot }: SheetErrorProps): JSX.Element {
  return (
    <p
      className="border-b border-border/50 px-4 py-3 text-[11px] text-destructive"
      role="alert"
      data-slot={slot}
    >
      {children}
    </p>
  );
}

/** Props for {@link SheetChapter}. */
export interface SheetChapterProps {
  readonly label: string;
  readonly hint?: string;
  readonly children?: ReactNode;
}

/**
 * Scan break between sheet sections (Gate, Rows, Options, SQL).
 *
 * @param props - Chapter label + optional hint or trailing action
 */
export function SheetChapter({ label, hint, children }: SheetChapterProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-muted/25 px-4 py-1.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-foreground uppercase">
          {label}
        </p>
        {hint ? <p className="truncate text-[10px] text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** Props for {@link SheetPair}. */
export interface SheetPairProps {
  readonly children: ReactNode;
}

/**
 * Two {@link SheetField}s on one row. Use `split="start"` / `split="end"`.
 *
 * @param props - Paired fields
 */
export function SheetPair({ children }: SheetPairProps): JSX.Element {
  return <div className="grid grid-cols-2 border-b border-border/50">{children}</div>;
}

/** Props for {@link SheetGrid}. */
export interface SheetGridProps {
  /** Max columns when the container is wide enough. */
  readonly columns?: 2 | 3 | 4;
  readonly children: ReactNode;
}

/**
 * Field grid — equal columns that fill the row; drops as the dock narrows.
 *
 * @param props - Fields + optional column cap
 */
export function SheetGrid({ columns = 4, children }: SheetGridProps): JSX.Element {
  const count = Children.count(children);
  const max = Math.min(columns, count) as 1 | 2 | 3 | 4;
  return (
    <div className="@container w-full min-w-0 max-w-full">
      <div
        className={cn(
          "grid w-full min-w-0 grid-cols-1",
          max >= 2 && "@min-[18rem]:grid-cols-2",
          max >= 3 && "@min-[26rem]:grid-cols-3",
          max >= 4 && "@min-[34rem]:grid-cols-4",
          "[&>*]:min-w-0 [&>*]:border-r [&>*]:border-border/50",
          max >= 2 && "@min-[18rem]:[&>*:nth-child(2n)]:border-r-0",
          max >= 3 &&
            "@min-[26rem]:[&>*:nth-child(2n)]:border-r @min-[26rem]:[&>*:nth-child(3n)]:border-r-0",
          max >= 4 &&
            "@min-[34rem]:[&>*:nth-child(2n)]:border-r @min-[34rem]:[&>*:nth-child(3n)]:border-r @min-[34rem]:[&>*:nth-child(4n)]:border-r-0",
          max < 2 && "[&>*]:border-r-0",
          "[&>*:last-child]:border-r-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
