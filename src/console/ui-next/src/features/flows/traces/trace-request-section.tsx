/**
 * Trace Request section — protocol frame with Fields / Raw body views.
 */

import { useEffect, useMemo, useState, type JSX, type MouseEvent } from "react";
import {
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
  /** Whether the body panel is expanded. */
  readonly inputOpen: boolean;
  /** Expand / collapse the body panel. */
  readonly onInputOpenChange: (open: boolean) => void;
};

type BodyView = "fields" | "raw";

const sheetControlButtonClass =
  "border border-border bg-background shadow-none hover:bg-muted";

/**
 * Request section — method rail + endpoint + Fields/Raw body instrument.
 *
 * @param props - Manifest request meta + run input
 */
export function TraceRequestSection({
  method,
  path,
  headline,
  input,
  inputOpen,
  onInputOpenChange,
}: TraceRequestSectionProps): JSX.Element {
  const hasInput = input !== null && input !== undefined;
  const endpoint = method && path ? `${method} ${path}` : headline;
  const inputJson = useMemo(
    () => (hasInput ? JSON.stringify(input, null, 2) : ""),
    [hasInput, input],
  );
  const rows = useMemo(() => (hasInput ? inputFieldRows(input) : null), [hasInput, input]);
  const shapeHint = useMemo(() => (hasInput ? inputShapeHint(input) : null), [hasInput, input]);
  const byteLabel = useMemo(
    () => (hasInput ? inputByteLabel(inputJson) : null),
    [hasInput, inputJson],
  );
  const [view, setView] = useState<BodyView>(rows ? "fields" : "raw");

  useEffect(() => {
    setView(rows ? "fields" : "raw");
  }, [rows]);

  return (
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

            {hasInput ? (
              <Collapsible open={inputOpen} onOpenChange={onInputOpenChange}>
                <div className="flex items-center gap-1 border-t border-border/45 px-2 py-1">
                  <CollapsibleTrigger
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-medium text-foreground/85 hover:text-foreground"
                    data-slot="trace-input-toggle"
                  >
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={cn(
                        "size-3.5 shrink-0 text-muted-foreground transition-transform",
                        !inputOpen && "-rotate-90",
                      )}
                    />
                    <span>Body</span>
                    {shapeHint ? (
                      <span className="truncate font-normal text-muted-foreground">
                        · {shapeHint}
                      </span>
                    ) : null}
                    {byteLabel ? (
                      <span className="shrink-0 font-mono text-[10px] font-normal text-muted-foreground tabular-nums">
                        {byteLabel}
                      </span>
                    ) : null}
                  </CollapsibleTrigger>
                  {rows ? (
                    <BodyViewToggle view={view} onChange={setView} />
                  ) : null}
                  <CopyIconButton
                    label="Copy body JSON"
                    text={inputJson}
                    dataSlot="trace-request-copy-input"
                  />
                </div>
                <CollapsibleContent>
                  <div className="border-t border-border/40">
                    {view === "fields" && rows ? (
                      <FieldsTable rows={rows} />
                    ) : (
                      <HighlightedJson json={inputJson} />
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <p className="border-t border-border/45 px-2.5 py-2 text-[11px] text-muted-foreground">
                No stored input — replay uses an empty body when the ledger has none.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
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
function FieldsTable({ rows }: { readonly rows: readonly InputFieldRow[] }): JSX.Element {
  return (
    <ul className="divide-y divide-border/40" data-slot="trace-request-fields">
      {rows.map((row) => (
        <li
          key={row.key}
          className="group/field flex items-start gap-2 px-2.5 py-1.5 hover:bg-muted/40"
          data-slot="trace-request-field"
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
              dataSlot="trace-request-copy-field"
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
function HighlightedJson({ json }: { readonly json: string }): JSX.Element {
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
      data-slot="trace-input-json"
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
