/**
 * Trace Request + Response sections — protocol frames with Fields / Raw views.
 */

import { useEffect, useMemo, useState, type JSX, type MouseEvent } from "react";
import {
  Alert02Icon,
  ArrowDown01Icon,
  Copy01Icon,
  ListViewIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/theme-provider";
import { highlightCode } from "@/lib/highlight.ts";
import { cn } from "@/lib/utils";
import { httpMethodBadgeClass, httpMethodRailClass } from "./http-method.ts";
import {
  fieldCopyText,
  inputByteLabel,
  inputFieldRows,
  inputShapeHint,
  type InputFieldKind,
  type InputFieldRow,
} from "./request-input-view.ts";

/** Props for {@link TraceRequestSection}. */
export type TraceRequestSectionProps = {
  /** HTTP method from Manifest, when available. */
  readonly method: string | null;
  /** HTTP path from Manifest, when available. */
  readonly path: string | null;
  /** Fallback headline (signal name, etc.). */
  readonly headline: string;
  /** Projected run input snapshot. */
  readonly input: unknown;
  /** Projected run output snapshot. */
  readonly output: unknown;
  /** Declared / framework error code when the run failed. */
  readonly error: string | null;
  /** Optional human message paired with {@link error}. */
  readonly errorMessage: string | null;
  /** Whether the request body panel is expanded. */
  readonly inputOpen: boolean;
  /** Expand / collapse the request body panel. */
  readonly onInputOpenChange: (open: boolean) => void;
  /** Whether the output panel is expanded. */
  readonly outputOpen: boolean;
  /** Expand / collapse the output panel. */
  readonly onOutputOpenChange: (open: boolean) => void;
};

type BodyView = "fields" | "raw";

const sheetControlButtonClass =
  "border border-border bg-background shadow-none hover:bg-muted";

/**
 * Request + Response — method rail + endpoint, then return-value frame.
 *
 * @param props - Manifest request meta + run input/output
 */
export function TraceRequestSection({
  method,
  path,
  headline,
  input,
  output,
  error,
  errorMessage,
  inputOpen,
  onInputOpenChange,
  outputOpen,
  onOutputOpenChange,
}: TraceRequestSectionProps): JSX.Element {
  const endpoint = method && path ? `${method} ${path}` : headline;
  const failed = error !== null;

  return (
    <>
      <section
        className="flex flex-col gap-2 border-b border-border/60 px-3 py-3 last:border-b-0"
        data-slot="trace-request"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold tracking-wider text-foreground/75 uppercase">
            Request
          </h3>
          {endpoint ? (
            <CopyIconButton
              label="Copy endpoint"
              text={endpoint}
              dataSlot="trace-request-copy-endpoint"
            />
          ) : null}
        </div>

        <div
          className="overflow-hidden rounded-md border border-border/55 bg-muted/15"
          data-slot="trace-request-frame"
        >
          <div className="flex min-w-0">
            <MethodRail method={method} />
            <div className="flex min-w-0 flex-1 flex-col">
              <RequestEndpoint method={method} path={path} headline={headline} />
              <PayloadPanel
                value={input}
                open={inputOpen}
                onOpenChange={onInputOpenChange}
                label="Body"
                empty="No stored input — replay uses an empty body when the ledger has none."
                copyLabel="Copy body JSON"
                copySlot="trace-request-copy-input"
                toggleSlot="trace-input-toggle"
                fieldsSlot="trace-request-fields"
                jsonSlot="trace-input-json"
              />
            </div>
          </div>
        </div>
      </section>

      <section
        className="flex flex-col gap-2 border-b border-border/60 px-3 py-3 last:border-b-0"
        data-slot="trace-response"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold tracking-wider text-foreground/75 uppercase">
            Response
          </h3>
          {!failed && output !== null && output !== undefined ? (
            <CopyIconButton
              label="Copy response JSON"
              text={JSON.stringify(output, null, 2)}
              dataSlot="trace-response-copy"
            />
          ) : null}
          {failed ? (
            <CopyIconButton
              label="Copy error"
              text={[error, errorMessage].filter(Boolean).join("\n")}
              dataSlot="trace-response-copy-error"
            />
          ) : null}
        </div>

        {failed ? (
          <div
            className="overflow-hidden rounded-md border border-destructive/35 bg-destructive/8"
            data-slot="trace-response-error"
            role="alert"
          >
            <div className="flex min-w-0">
              <div
                className="w-1 shrink-0 self-stretch bg-destructive"
                aria-hidden
                data-slot="trace-response-rail"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2.5">
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    className="size-3.5 shrink-0 text-destructive"
                    aria-hidden
                  />
                  <span className="font-mono text-xs font-semibold text-destructive">
                    {error}
                  </span>
                </div>
                {errorMessage ? (
                  <p className="text-[11px] leading-snug text-destructive/90">{errorMessage}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Run failed with this error code — no return value was stored.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-md border border-border/55 bg-muted/15"
            data-slot="trace-response-frame"
          >
            <div className="flex min-w-0">
              <div
                className="w-1 shrink-0 self-stretch bg-emerald-500"
                aria-hidden
                data-slot="trace-response-rail"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <PayloadPanel
                  value={output}
                  open={outputOpen}
                  onOpenChange={onOutputOpenChange}
                  label="Body"
                  empty="No stored response — this run completed without a return value."
                  copyLabel="Copy response JSON"
                  copySlot="trace-response-copy-body"
                  toggleSlot="trace-response-toggle"
                  fieldsSlot="trace-response-fields"
                  jsonSlot="trace-response-json"
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Collapsible Fields/Raw payload panel shared by Request and Output.
 *
 * @param props - Value + chrome labels
 */
function PayloadPanel({
  value,
  open,
  onOpenChange,
  label,
  empty,
  copyLabel,
  copySlot,
  toggleSlot,
  fieldsSlot,
  jsonSlot,
}: {
  readonly value: unknown;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly empty: string;
  readonly copyLabel: string;
  readonly copySlot: string;
  readonly toggleSlot: string;
  readonly fieldsSlot: string;
  readonly jsonSlot: string;
}): JSX.Element {
  const hasValue = value !== null && value !== undefined;
  const json = useMemo(
    () => (hasValue ? JSON.stringify(value, null, 2) : ""),
    [hasValue, value],
  );
  const rows = useMemo(() => (hasValue ? inputFieldRows(value) : null), [hasValue, value]);
  const shapeHint = useMemo(() => (hasValue ? inputShapeHint(value) : null), [hasValue, value]);
  const byteLabel = useMemo(
    () => (hasValue ? inputByteLabel(json) : null),
    [hasValue, json],
  );
  const [view, setView] = useState<BodyView>(rows ? "fields" : "raw");

  useEffect(() => {
    setView(rows ? "fields" : "raw");
  }, [rows]);

  if (!hasValue) {
    return (
      <p className="border-t border-border/45 px-2.5 py-2 text-[11px] text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center gap-1 border-t border-border/45 px-2 py-1">
        <CollapsibleTrigger
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-medium text-foreground/85 hover:text-foreground"
          data-slot={toggleSlot}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span>{label}</span>
          {shapeHint ? (
            <span className="truncate font-normal text-muted-foreground">· {shapeHint}</span>
          ) : null}
          {byteLabel ? (
            <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
              {byteLabel}
            </span>
          ) : null}
        </CollapsibleTrigger>
        {rows ? <BodyViewToggle view={view} onChange={setView} /> : null}
        <CopyIconButton label={copyLabel} text={json} dataSlot={copySlot} />
      </div>
      <CollapsibleContent>
        <div className="border-t border-border/40">
          {view === "fields" && rows ? (
            <FieldsTable rows={rows} dataSlot={fieldsSlot} />
          ) : (
            <HighlightedJson json={json} dataSlot={jsonSlot} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Method-colored vertical rail — signature of the protocol frame.
 *
 * @param props - HTTP method
 */
function MethodRail({ method }: { readonly method: string | null }): JSX.Element {
  return (
    <div
      className={cn(
        "w-1 shrink-0 self-stretch",
        method ? httpMethodRailClass(method) : "bg-muted-foreground/50",
      )}
      aria-hidden
      data-slot="trace-request-rail"
    />
  );
}

/**
 * Endpoint row inside the protocol frame.
 *
 * @param props - Method / path / headline
 */
function RequestEndpoint({
  method,
  path,
  headline,
}: {
  readonly method: string | null;
  readonly path: string | null;
  readonly headline: string;
}): JSX.Element {
  if (method && path) {
    return (
      <div
        className="flex min-w-0 items-center gap-2 px-2.5 py-2"
        data-slot="trace-request-endpoint"
      >
        <Badge
          variant="outline"
          className={cn(
            "h-5 shrink-0 rounded-md px-1.5 font-mono text-[10px] font-semibold tracking-wide uppercase",
            httpMethodBadgeClass(method),
          )}
          data-slot="trace-request-method"
        >
          {method}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground select-all">
          {path}
        </span>
      </div>
    );
  }
  return (
    <div
      className="px-2.5 py-2 font-mono text-xs text-foreground select-all"
      data-slot="trace-request-endpoint"
    >
      {headline}
    </div>
  );
}

/**
 * Segmented Fields / Raw control.
 *
 * @param props - Active view + change handler
 */
function BodyViewToggle({
  view,
  onChange,
}: {
  readonly view: BodyView;
  readonly onChange: (next: BodyView) => void;
}): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center rounded-md border border-border/60 bg-background/60 p-0.5"
      role="group"
      aria-label="Body view"
      data-slot="trace-request-view-toggle"
    >
      <ViewToggleButton
        active={view === "fields"}
        label="Fields"
        icon={ListViewIcon}
        onClick={() => onChange("fields")}
      />
      <ViewToggleButton
        active={view === "raw"}
        label="Raw"
        icon={SourceCodeIcon}
        onClick={() => onChange("raw")}
      />
    </div>
  );
}

function ViewToggleButton({
  active,
  label,
  icon,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly icon: typeof ListViewIcon;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-[10px] font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className="size-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * Interactive key / value table for flat object bodies.
 *
 * @param props - Projected field rows
 */
function FieldsTable({
  rows,
  dataSlot,
}: {
  readonly rows: readonly InputFieldRow[];
  readonly dataSlot: string;
}): JSX.Element {
  return (
    <ul className="divide-y divide-border/40" data-slot={dataSlot}>
      {rows.map((row) => (
        <li
          key={row.key}
          className="group/field flex items-start gap-2 px-2.5 py-1.5 hover:bg-muted/40"
          data-slot="trace-payload-field"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="w-[7.5rem] shrink-0 truncate font-mono text-[11px] font-medium text-sky-600 dark:text-sky-400">
              {row.key}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 break-all font-mono text-[11px] leading-snug",
                valueToneClass(row.kind),
              )}
              title={row.display}
            >
              {row.display}
            </span>
          </div>
          <span className="mt-0.5 shrink-0 font-mono text-[9px] tracking-wide text-muted-foreground uppercase opacity-70">
            {row.kind}
          </span>
          <div className="opacity-0 transition-opacity group-hover/field:opacity-100 group-focus-within/field:opacity-100">
            <CopyIconButton
              label={`Copy ${row.key}`}
              text={fieldCopyText(row.value)}
              dataSlot="trace-payload-copy-field"
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function valueToneClass(kind: InputFieldKind): string {
  switch (kind) {
    case "string":
      return "text-rose-700/90 dark:text-rose-300/90";
    case "number":
      return "text-amber-800 dark:text-amber-300";
    case "boolean":
      return "text-emerald-700 dark:text-emerald-400";
    case "null":
      return "text-muted-foreground italic";
    default:
      return "text-foreground/80";
  }
}

/**
 * Compact copy control with brief confirmation.
 *
 * @param props - Clipboard text + accessible label
 */
function CopyIconButton({
  text,
  label,
  dataSlot,
}: {
  readonly text: string;
  readonly label: string;
  readonly dataSlot: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  const onCopy = async (event: MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <Button
            {...props}
            type="button"
            variant="outline"
            size="icon-xs"
            className={sheetControlButtonClass}
            aria-label={copied ? "Copied" : label}
            data-slot={dataSlot}
            onClick={(event) => {
              props.onClick?.(event);
              void onCopy(event);
            }}
          >
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
          </Button>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        {copied ? "Copied" : label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Shiki-highlighted JSON block for the Raw body view.
 *
 * @param props - Pre-serialized JSON
 */
function HighlightedJson({
  json,
  dataSlot,
}: {
  readonly json: string;
  readonly dataSlot: string;
}): JSX.Element {
  const { theme } = useTheme();
  const [nodes, setNodes] = useState<JSX.Element | null>(null);
  const lines = useMemo(() => json.split("\n"), [json]);

  useEffect(() => {
    let cancelled = false;
    const root = window.document.documentElement;
    const dark =
      theme === "dark" || (theme === "system" && root.classList.contains("dark"));
    void highlightCode(json, {
      lang: "json",
      theme: dark ? "github-dark" : "github-light",
    }).then((el) => {
      if (!cancelled) setNodes(el);
    });
    return () => {
      cancelled = true;
    };
  }, [json, theme]);

  return (
    <div
      data-slot={dataSlot}
      className="flex max-h-56 overflow-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div
        className="sticky left-0 select-none border-r border-border/40 bg-muted/30 px-1.5 py-1.5 text-right font-mono text-[10px] leading-snug text-muted-foreground/80"
        aria-hidden
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="min-w-0 flex-1 px-2 py-1.5 text-[11px] leading-snug [&_pre]:m-0 [&_pre]:bg-transparent! [&_code]:font-mono">
        {nodes ?? (
          <pre className="font-mono whitespace-pre-wrap text-muted-foreground">{json}</pre>
        )}
      </div>
    </div>
  );
}
