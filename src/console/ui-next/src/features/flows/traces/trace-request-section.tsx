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
import {
  EXPLORER_CHEVRON_CLASS,
  EXPLORER_ICON_BUTTON_BARE_CLASS,
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  SECTION_HEAD_CLASS,
  explorerIconInk,
} from "@/components/explorer/explorer-chrome.ts";
import { HighlightedJson } from "@/components/highlighted-json";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RunHttpFrame } from "@/client.ts";
import { httpMethodBadgeClass, httpMethodRailClass } from "./http-method.ts";
import { RequestClientCard } from "./request-client-card.tsx";
import { httpStatusRailClass, httpStatusReason, httpStatusTextClass } from "./http-status.ts";
import {
  fieldCopyText,
  inputByteLabel,
  inputFieldRows,
  inputShapeHint,
  payloadHasContent,
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
  /**
   * HTTP wire frame. `null` for non-HTTP runs and rows recorded before the
   * frame existed — those still show the body only.
   */
  readonly http: RunHttpFrame | null;
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

const FILL_COL_CLASS = "flex min-h-0 flex-1 flex-col";
const JSON_FILL_CLASS =
  "flex min-h-0 flex-1 overflow-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

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
  http,
  error,
  errorMessage,
  inputOpen,
  onInputOpenChange,
  outputOpen,
  onOutputOpenChange,
}: TraceRequestSectionProps): JSX.Element {
  const shownMethod = http?.request.method ?? method;
  const shownPath = http?.request.path ?? path;
  const endpoint = shownMethod && shownPath ? `${shownMethod} ${shownPath}` : headline;
  const query = http?.request.query ?? {};
  const requestHeaders = http?.request.headers ?? {};
  const hasQuery = Object.keys(query).length > 0;
  const hasRequestHeaders = Object.keys(requestHeaders).length > 0;
  const responseStatus = http?.response?.status;
  const responseHeaders = http?.response?.headers ?? {};
  const hasResponseHeaders = Object.keys(responseHeaders).length > 0;
  const failed = error !== null;
  const hasInput = payloadHasContent(input);
  const hasOutput = payloadHasContent(output);
  const responseFills = outputOpen && !failed && hasOutput;
  const requestFills = inputOpen && hasInput && !responseFills;

  return (
    <>
      <section
        className={cn(
          "border-b border-border/60 last:border-b-0",
          requestFills && cn(FILL_COL_CLASS, "pb-3"),
        )}
        data-slot="trace-request"
      >
        <div className={EXPLORER_STRIP_CLASS}>
          <h3 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>Request</h3>
          {endpoint ? (
            <div className="ml-auto flex h-full items-stretch">
              <CopyIconButton
                label="Copy endpoint"
                text={endpoint}
                dataSlot="trace-request-copy-endpoint"
              />
            </div>
          ) : null}
        </div>

        <div data-slot="trace-request-frame" className={requestFills ? FILL_COL_CLASS : undefined}>
          <div className={cn("flex min-w-0", requestFills && "min-h-0 flex-1")}>
            <MethodRail method={shownMethod} />
            <div className={cn("flex min-w-0 flex-1 flex-col", requestFills && "min-h-0")}>
              <RequestEndpoint method={shownMethod} path={shownPath} headline={headline} />
              {hasRequestHeaders ? <RequestClientCard headers={requestHeaders} /> : null}
              {hasQuery ? (
                <PayloadPanel
                  value={query}
                  open
                  onOpenChange={() => undefined}
                  label="Query"
                  empty=""
                  copyLabel="Copy query JSON"
                  copySlot="trace-request-copy-query"
                  toggleSlot="trace-request-query-toggle"
                  fieldsSlot="trace-request-query"
                  jsonSlot="trace-request-query-json"
                  localOpen
                />
              ) : null}
              {hasRequestHeaders ? (
                <PayloadPanel
                  value={requestHeaders}
                  open
                  onOpenChange={() => undefined}
                  label="Headers"
                  empty=""
                  copyLabel="Copy request headers"
                  copySlot="trace-request-copy-headers"
                  toggleSlot="trace-request-headers-toggle"
                  fieldsSlot="trace-request-headers"
                  jsonSlot="trace-request-headers-json"
                  localOpen
                />
              ) : null}
              {hasInput ? (
                <PayloadPanel
                  value={input}
                  open={inputOpen}
                  onOpenChange={onInputOpenChange}
                  label="Body"
                  empty=""
                  copyLabel="Copy body JSON"
                  copySlot="trace-request-copy-input"
                  toggleSlot="trace-input-toggle"
                  fieldsSlot="trace-request-fields"
                  jsonSlot="trace-input-json"
                  fill={requestFills}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section
        className={cn(
          "border-b border-border/60 last:border-b-0",
          responseFills && cn(FILL_COL_CLASS, "pb-3"),
        )}
        data-slot="trace-response"
      >
        <div className={EXPLORER_STRIP_CLASS}>
          <h3 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>Response</h3>
          <div className="ml-auto flex h-full items-stretch">
            {!failed && hasOutput ? (
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
        </div>

        {failed && responseStatus === undefined ? (
          <ResponseError error={error} errorMessage={errorMessage} />
        ) : (
          <div
            data-slot="trace-response-frame"
            className={responseFills ? FILL_COL_CLASS : undefined}
          >
            <div className={cn("flex min-w-0", responseFills && "min-h-0 flex-1")}>
              <div
                className={cn(
                  "w-1 shrink-0 self-stretch",
                  responseStatus !== undefined
                    ? httpStatusRailClass(responseStatus)
                    : "bg-emerald-500",
                )}
                aria-hidden
                data-slot="trace-response-rail"
              />
              <div className={cn("flex min-w-0 flex-1 flex-col", responseFills && "min-h-0")}>
                {responseStatus !== undefined ? <ResponseStatus status={responseStatus} /> : null}
                {hasResponseHeaders ? (
                  <PayloadPanel
                    value={responseHeaders}
                    open
                    onOpenChange={() => undefined}
                    label="Headers"
                    empty=""
                    copyLabel="Copy response headers"
                    copySlot="trace-response-copy-headers"
                    toggleSlot="trace-response-headers-toggle"
                    fieldsSlot="trace-response-headers"
                    jsonSlot="trace-response-headers-json"
                    localOpen
                  />
                ) : null}
                {failed ? (
                  <ResponseError error={error} errorMessage={errorMessage} bare />
                ) : hasOutput ? (
                  <PayloadPanel
                    value={output}
                    open={outputOpen}
                    onOpenChange={onOutputOpenChange}
                    label="Body"
                    empty=""
                    copyLabel="Copy response JSON"
                    copySlot="trace-response-copy-body"
                    toggleSlot="trace-response-toggle"
                    fieldsSlot="trace-response-fields"
                    jsonSlot="trace-response-json"
                    fill={responseFills}
                  />
                ) : null}
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Status line for an HTTP response frame.
 *
 * @param props - Status code
 */
function ResponseStatus({ status }: { readonly status: number }): JSX.Element {
  const reason = httpStatusReason(status);
  return (
    <div className="flex min-w-0 items-center gap-2 px-2.5 py-2" data-slot="trace-response-status">
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] font-semibold tabular-nums",
          httpStatusTextClass(status),
        )}
      >
        {status}
      </span>
      {reason ? <span className="font-mono text-xs text-foreground">{reason}</span> : null}
    </div>
  );
}

/**
 * Failed-run alert. `bare` sits inside a frame that already has a rail.
 *
 * @param props - Error code and optional message
 */
function ResponseError({
  error,
  errorMessage,
  bare = false,
}: {
  readonly error: string | null;
  readonly errorMessage: string | null;
  readonly bare?: boolean;
}): JSX.Element {
  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2.5">
      <div className="flex items-center gap-1.5">
        <HugeiconsIcon
          icon={Alert02Icon}
          className="size-3.5 shrink-0 text-destructive"
          aria-hidden
        />
        <span className="font-mono text-xs font-semibold text-destructive">{error}</span>
      </div>
      {errorMessage ? (
        <p className="text-[11px] leading-snug text-destructive/90">{errorMessage}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Run failed with this error code — no return value was stored.
        </p>
      )}
    </div>
  );
  if (bare) {
    return (
      <div data-slot="trace-response-error" role="alert" className="border-t border-border/60">
        {body}
      </div>
    );
  }
  return (
    <div data-slot="trace-response-error" role="alert">
      <div className="flex min-w-0">
        <div
          className="w-1 shrink-0 self-stretch bg-destructive"
          aria-hidden
          data-slot="trace-response-rail"
        />
        {body}
      </div>
    </div>
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
  fill = false,
  localOpen = false,
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
  /** Grow to fill leftover sheet height instead of capping at 14rem. */
  readonly fill?: boolean;
  /** Own the open state, starting expanded. Used for query and headers. */
  readonly localOpen?: boolean;
}): JSX.Element {
  const hasValue = value !== null && value !== undefined;
  const json = useMemo(() => (hasValue ? JSON.stringify(value, null, 2) : ""), [hasValue, value]);
  const rows = useMemo(() => (hasValue ? inputFieldRows(value) : null), [hasValue, value]);
  const shapeHint = useMemo(() => (hasValue ? inputShapeHint(value) : null), [hasValue, value]);
  const byteLabel = useMemo(() => (hasValue ? inputByteLabel(json) : null), [hasValue, json]);
  const [view, setView] = useState<BodyView>(rows ? "fields" : "raw");
  const [ownOpen, setOwnOpen] = useState(true);
  const panelOpen = localOpen ? ownOpen : open;
  const setPanelOpen = localOpen ? setOwnOpen : onOpenChange;

  useEffect(() => {
    setView(rows ? "fields" : "raw");
  }, [rows]);

  if (!hasValue) {
    return (
      <p className="border-t border-border/60 px-2 py-2 text-[11px] text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <Collapsible
      open={panelOpen}
      onOpenChange={setPanelOpen}
      className={fill ? FILL_COL_CLASS : "shrink-0"}
    >
      <div className={cn(EXPLORER_STRIP_CLASS, "border-t")}>
        <CollapsibleTrigger
          className={cn(EXPLORER_STRIP_TOKEN_CLASS, "min-w-0 flex-1 justify-start")}
          data-slot={toggleSlot}
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn(EXPLORER_CHEVRON_CLASS, !panelOpen && "-rotate-90")}
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
      <CollapsibleContent className={fill ? cn(FILL_COL_CLASS, "overflow-hidden") : undefined}>
        <div className={cn("border-t border-border/60", fill && FILL_COL_CLASS)}>
          {view === "fields" && rows ? (
            <div className={fill ? "min-h-0 flex-1 overflow-auto pb-3" : undefined}>
              <FieldsTable rows={rows} dataSlot={fieldsSlot} />
            </div>
          ) : (
            <HighlightedJson
              json={json}
              dataSlot={jsonSlot}
              className={fill ? JSON_FILL_CLASS : undefined}
            />
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
        <span
          className={cn(
            "shrink-0 font-mono text-[10px] font-semibold tracking-[0.08em] uppercase",
            explorerIconInk(httpMethodBadgeClass(method)),
          )}
          data-slot="trace-request-method"
        >
          {method}
        </span>
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
      className="flex h-full shrink-0 items-stretch"
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
        EXPLORER_STRIP_TOKEN_CLASS,
        "font-semibold tracking-[0.08em] uppercase",
        active ? EXPLORER_STRIP_TOKEN_ACTIVE_CLASS : EXPLORER_STRIP_TOKEN_IDLE_CLASS,
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
 * Interactive key / value tree. Objects and arrays expand into child fields.
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
    <ul data-slot={dataSlot}>
      {rows.map((row) => (
        <PayloadFieldRow key={row.key} row={row} depth={0} />
      ))}
    </ul>
  );
}

/**
 * One payload field. Containers toggle a nested field list.
 *
 * @param props - Row + indent depth
 */
function PayloadFieldRow({
  row,
  depth,
}: {
  readonly row: InputFieldRow;
  readonly depth: number;
}): JSX.Element {
  const expandable = row.children !== null;
  const [open, setOpen] = useState(false);

  return (
    <li data-slot="trace-payload-field" data-depth={depth}>
      <div
        className={cn(EXPLORER_ROW_CLASS, "group/field items-start")}
        style={depth > 0 ? { paddingLeft: `${10 + depth * 14}px` } : undefined}
      >
        {expandable ? (
          <button
            type="button"
            className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center text-muted-foreground"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${row.key}`}
            data-slot="trace-payload-expand"
            onClick={() => setOpen((next) => !next)}
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className={cn(EXPLORER_CHEVRON_CLASS, !open && "-rotate-90")}
            />
          </button>
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
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
            bare
          />
        </div>
      </div>
      {expandable && open ? (
        <ul data-slot="trace-payload-children">
          {row.children?.map((child) => (
            <PayloadFieldRow key={child.key} row={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function valueToneClass(kind: InputFieldKind): string {
  switch (kind) {
    case "string":
      return "text-teal-800/90 dark:text-teal-300/90";
    case "number":
      return "text-amber-800 dark:text-amber-300";
    case "boolean":
      return "text-violet-800 dark:text-violet-300";
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
  bare = false,
}: {
  readonly text: string;
  readonly label: string;
  readonly dataSlot: string;
  readonly bare?: boolean;
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
          <button
            {...props}
            type="button"
            className={bare ? EXPLORER_ICON_BUTTON_BARE_CLASS : EXPLORER_ICON_BUTTON_CLASS}
            aria-label={copied ? "Copied" : label}
            data-slot={dataSlot}
            onClick={(event) => {
              props.onClick?.(event);
              void onCopy(event);
            }}
          >
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-3.5" />
          </button>
        )}
      />
      <TooltipContent side="bottom" className="text-[11px]">
        {copied ? "Copied" : label}
      </TooltipContent>
    </Tooltip>
  );
}
