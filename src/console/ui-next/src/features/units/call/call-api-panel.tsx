/**
 * Units Call API — trigger-aware action zone (invoke / run-now).
 */

import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import {
  Alert02Icon,
  ArrowExpand01Icon,
  ArrowReloadHorizontalIcon,
  ListViewIcon,
  Loading03Icon,
  PlayIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { FlowIdentity } from "@/client.ts";
import { CopyInlineButton } from "@/components/explorer/copy-inline-button.tsx";
import { EXPLORER_TOOLBAR_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { HighlightedJson } from "@/components/highlighted-json";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToolbarTip } from "@/components/ui/toolbar-tip.tsx";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SHEET_CONTROL, SheetField, SheetGrid } from "@/components/ui/sheet-form.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import { useStoreQuery } from "@/features/store/data/use-store-query.ts";
import { useClockRunNow, useFlowsIdentities, useFlowsInvoke } from "../data/use-flows-invoke.ts";
import {
  fieldConstraintHint,
  fieldsFromSchema,
  integerSelectValues,
  schemaObject,
  seedFromSchema,
  type FormField,
} from "../lib/fields-from-schema.ts";
import { fkOptionsFromRows, resolveFkLookup, type FkOption } from "../lib/fk-lookup.ts";
import { flowTriggerKind } from "../lib/flow-trigger.ts";
import { pathParamNames, pathParamPlaceholder, seedPathValues } from "../lib/path-params.ts";
import { resolveClockForFlow, type ClockResolveResult } from "../lib/resolve-clock.ts";
import { validateContract } from "../lib/validate-contract.ts";
import type { UnitFlowRow } from "../lib/unit-tree.ts";

/** Props for {@link CallApiPanel}. */
export interface CallApiPanelProps {
  readonly row: UnitFlowRow;
  readonly manifest: Manifest | null;
}

/**
 * Closed-trigger label — name only so the dock toolbar stays one line.
 *
 * @param identities - Available identities
 * @param id - Selected identity id (API key)
 */
function identityTriggerLabel(
  identities: readonly FlowIdentity[],
  id: string | null | undefined,
): string {
  if (!id) return "";
  const match = identities.find((row) => row.id === id);
  return match ? match.name : id;
}

/** Body editor mode — structured fields or raw JSON (matches Trace Request). */
type BodyView = "fields" | "raw";

/**
 * Pretty-print a body object for the Raw editor.
 *
 * @param value - Body object
 */
function stringifyBody(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Request builder + real host action — interactive zone, shaped by trigger kind.
 *
 * @param props - Selected flow row + Manifest
 */
export function CallApiPanel({ row, manifest }: CallApiPanelProps): JSX.Element {
  const kind = flowTriggerKind(row.flow.trigger);
  if (kind === "cron" || kind === "every") {
    return <ClockRunPanel row={row} manifest={manifest} />;
  }
  return <InvokeBodyPanel row={row} kind={kind} manifest={manifest} />;
}

/**
 * Cron / Every — prefer lease-gated clock run-now; honest invoke fallback.
 *
 * @param props - Flow + Manifest
 */
function ClockRunPanel({
  row,
  manifest,
}: {
  readonly row: UnitFlowRow;
  readonly manifest: Manifest | null;
}): JSX.Element {
  const resolve: ClockResolveResult = useMemo(
    () => resolveClockForFlow(manifest, row.id),
    [manifest, row.id],
  );
  const clockRun = useClockRunNow();
  const identities = useFlowsIdentities();
  const invoke = useFlowsInvoke();
  const [asUserId, setAsUserId] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pathUsed, setPathUsed] = useState<"clock" | "invoke" | null>(null);

  useEffect(() => {
    clockRun.reset();
    invoke.reset();
    setPathUsed(null);
    setStartedAt(null);
  }, [row.id]);

  useEffect(() => {
    const first = identities.data?.find((i) => i.status === "active");
    if (first && !asUserId) setAsUserId(first.id);
  }, [identities.data, asUserId]);

  const matched = resolve.kind === "matched";

  async function onRun(): Promise<void> {
    setStartedAt(performance.now());
    if (matched) {
      setPathUsed("clock");
      try {
        await clockRun.mutateAsync({ name: resolve.clockName });
      } catch {
        // Error surface via mutation
      }
      return;
    }
    if (!asUserId) return;
    setPathUsed("invoke");
    try {
      await invoke.mutateAsync({
        flowId: row.id,
        body: {},
        asUserId,
      });
    } catch {
      // Error surface via mutation
    }
  }

  const pending = matched ? clockRun.isPending : invoke.isPending;
  const failed = matched
    ? clockRun.isError
    : invoke.isError || (invoke.isSuccess && invoke.data?.failure != null);
  const success = matched ? clockRun.isSuccess : invoke.isSuccess && !invoke.data?.failure;
  const elapsed = startedAt !== null && (success || failed) ? performance.now() - startedAt : null;

  const responseJson = useMemo(() => {
    if (matched && clockRun.data) {
      return JSON.stringify(clockRun.data, null, 2);
    }
    if (!matched && invoke.data) {
      return JSON.stringify(
        {
          status: invoke.data.status,
          failure: invoke.data.failure ?? null,
          response: invoke.data.response,
          path: "flows.invoke",
        },
        null,
        2,
      );
    }
    return null;
  }, [matched, clockRun.data, invoke.data]);

  const title = matched ? "Run now" : "Run handler";
  const submitLabel = matched ? "Run now" : "Run handler once";

  return (
    <CallDock
      title={title}
      dataMode={matched ? "clock" : "invoke-fallback"}
      actions={
        <>
          {!matched ? (
            <>
              <IdentitySelect
                identities={identities.data ?? []}
                value={asUserId}
                onChange={setAsUserId}
              />
              <DockSep />
            </>
          ) : null}
          <Button
            type="button"
            data-slot="call-api-submit"
            disabled={pending || (!matched && !asUserId)}
            onClick={() => void onRun()}
            className={DOCK_SUBMIT}
          >
            {pending ? (
              <>
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="animate-spin"
                  data-icon="inline-start"
                />
                Running…
              </>
            ) : (
              <>
                <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
                {submitLabel}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {matched ? (
          <p
            className="px-3 pt-2.5 pb-2 text-[11px] leading-snug text-muted-foreground"
            data-slot="clock-path-copy"
          >
            Fires Manifest clock{" "}
            <code className="rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
              {resolve.clockName}
            </code>{" "}
            via{" "}
            <code className="rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
              /console/clock/run-now
            </code>{" "}
            (lease-gated — the real scheduler path).
            {resolve.timezone ? (
              <>
                {" "}
                Timezone · <span className="font-mono">{resolve.timezone}</span>.
              </>
            ) : null}
          </p>
        ) : (
          <div
            className="mx-3 mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-foreground/90"
            data-slot="invoke-fallback-copy"
            role="note"
          >
            No unique Manifest clock matches this flow&apos;s schedule.{" "}
            <strong className="font-medium">Run handler once</strong> uses{" "}
            <code className="rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
              /console/flows/invoke
            </code>{" "}
            with empty input — it does <em>not</em> exercise the Clock lease / scheduler path.
          </div>
        )}

        <ResponseBlock
          failed={Boolean(failed)}
          success={Boolean(success)}
          elapsed={elapsed}
          statusCode={matched ? (clockRun.data?.ran ? 200 : 409) : invoke.data?.status}
          errorMessage={
            matched
              ? clockRun.isError
                ? (clockRun.error as Error).message
                : null
              : invoke.isError
                ? (invoke.error as Error).message
                : null
          }
          responseJson={responseJson}
          emptyHint={
            matched
              ? "Run now to fire the real clock tick."
              : "Run handler once to invoke with empty input."
          }
          pathUsed={pathUsed}
        />
      </div>
    </CallDock>
  );
}

/**
 * HTTP / signal / call-only — body form + kind-specific honesty copy.
 *
 * @param props - Flow + kind + Manifest (FK option lists)
 */
function InvokeBodyPanel({
  row,
  kind,
  manifest,
}: {
  readonly row: UnitFlowRow;
  readonly kind: "http" | "signal" | "cdc" | "internal";
  readonly manifest: Manifest | null;
}): JSX.Element {
  const identities = useFlowsIdentities();
  const invoke = useFlowsInvoke();
  const inSchema = schemaObject(row.flow.in);
  const fields = useMemo(() => fieldsFromSchema(inSchema), [inSchema]);
  const params = useMemo(
    () => (kind === "http" && row.path ? pathParamNames(row.path) : []),
    [kind, row.path],
  );

  const [asUserId, setAsUserId] = useState("");
  const [pathValues, setPathValues] = useState<Record<string, string>>(() =>
    seedPathValues(row.path, params),
  );
  const [body, setBody] = useState<Record<string, unknown>>(
    () => (seedFromSchema(inSchema) as Record<string, unknown>) ?? {},
  );
  const [bodyView, setBodyView] = useState<BodyView>("fields");
  const [rawText, setRawText] = useState(() =>
    stringifyBody((seedFromSchema(inSchema) as Record<string, unknown>) ?? {}),
  );
  const [rawError, setRawError] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<readonly { path: string; message: string }[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const seedBody = useMemo(
    () => (seedFromSchema(inSchema) as Record<string, unknown>) ?? {},
    [inSchema],
  );

  useEffect(() => {
    const next = (seedFromSchema(inSchema) as Record<string, unknown>) ?? {};
    setBody(next);
    setRawText(stringifyBody(next));
    setRawError(null);
    setBodyView("fields");
    setPathValues(seedPathValues(row.path, params));
    setLocalErrors([]);
    invoke.reset();
  }, [row.id]);

  useEffect(() => {
    const first = identities.data?.find((i) => i.status === "active");
    if (first && !asUserId) setAsUserId(first.id);
  }, [identities.data, asUserId]);

  /**
   * Parse Raw JSON into the body object. Returns false on failure.
   *
   * @param text - Raw JSON text
   */
  function commitRawText(text: string): boolean {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setRawError("Body must be a JSON object.");
        return false;
      }
      setBody(parsed as Record<string, unknown>);
      setRawError(null);
      return true;
    } catch (err) {
      setRawError(err instanceof Error ? err.message : "Invalid JSON.");
      return false;
    }
  }

  /**
   * Switch Fields ↔ Raw, syncing body state when valid.
   *
   * @param next - Target view
   */
  function onBodyViewChange(next: BodyView): void {
    if (next === bodyView) return;
    if (next === "raw") {
      setRawText(stringifyBody(body));
      setRawError(null);
      setBodyView("raw");
      return;
    }
    if (!commitRawText(rawText)) return;
    setBodyView("fields");
  }

  async function onCall(): Promise<void> {
    let nextBody = body;
    if (bodyView === "raw") {
      if (!commitRawText(rawText)) return;
      try {
        nextBody = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return;
      }
    }
    const local = validateContract(inSchema, nextBody);
    if (!local.ok) {
      setLocalErrors(local.errors);
      return;
    }
    setLocalErrors([]);
    if (!asUserId) return;
    setStartedAt(performance.now());
    try {
      await invoke.mutateAsync({
        flowId: row.id,
        body: nextBody,
        asUserId,
        ...(params.length > 0 ? { pathParams: pathValues } : {}),
      });
    } catch {
      // Error surface via invoke.isError
    }
  }

  function onReset(): void {
    setBody(seedBody);
    setRawText(stringifyBody(seedBody));
    setRawError(null);
    setPathValues(seedPathValues(row.path, params));
    setLocalErrors([]);
  }

  const elapsed =
    startedAt !== null && (invoke.isSuccess || invoke.isError)
      ? performance.now() - startedAt
      : null;

  const responseJson = useMemo(() => {
    if (!invoke.data) return null;
    return JSON.stringify(
      {
        status: invoke.data.status,
        failure: invoke.data.failure ?? null,
        response: invoke.data.response,
      },
      null,
      2,
    );
  }, [invoke.data]);

  const failed = invoke.isSuccess && invoke.data?.failure != null;
  const statusCode = invoke.data?.status;
  const actionTitle = kind === "http" ? "Call API" : kind === "signal" ? "Run handler" : "Invoke";
  const submitLabel = actionTitle;

  return (
    <CallDock
      title={actionTitle}
      dataTrigger={kind}
      actions={
        <>
          <IdentitySelect
            identities={identities.data ?? []}
            value={asUserId}
            onChange={setAsUserId}
          />
          <DockSep />
          <BodyViewToggle view={bodyView} onChange={onBodyViewChange} />
          <DockSep />
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <Button
                  {...props}
                  type="button"
                  variant="ghost"
                  data-slot="call-api-reset"
                  disabled={invoke.isPending}
                  onClick={onReset}
                  className={DOCK_TOOL}
                >
                  <HugeiconsIcon icon={ArrowReloadHorizontalIcon} data-icon="inline-start" />
                  Reset
                </Button>
              )}
            />
            <TooltipContent side="bottom" className="text-[11px]">
              Reset body to the schema example
            </TooltipContent>
          </Tooltip>
          <DockSep />
          <Button
            type="button"
            data-slot="call-api-submit"
            disabled={invoke.isPending || !asUserId}
            onClick={() => void onCall()}
            className={DOCK_SUBMIT}
          >
            {invoke.isPending ? (
              <>
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="animate-spin"
                  data-icon="inline-start"
                />
                Calling…
              </>
            ) : (
              <>
                <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
                {submitLabel}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 min-w-0 shrink overflow-y-auto">
          {kind === "http" ? (
            <p className="px-3 pt-2.5 pb-2 text-[11px] leading-snug text-muted-foreground">
              Operator session · invoke-as{" "}
              <code className="rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
                console:flows:invoke-as
              </code>
            </p>
          ) : null}
          {kind === "signal" ? (
            <div
              className="mx-3 mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-foreground/90"
              data-slot="signal-honest-copy"
              role="note"
            >
              <strong className="font-medium">Run handler directly</strong> — invokes the flow with
              your payload via{" "}
              <code className="rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
                /console/flows/invoke
              </code>
              . It does <em>not</em> publish on the signal bus, so it does not test delivery physics
              (once / broadcast / live, retries, dead-letter).
            </div>
          ) : null}
          {kind === "internal" ? (
            <div
              className="mx-3 mt-2.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[11px] leading-snug text-muted-foreground"
              data-slot="call-only-bypass-copy"
              role="note"
            >
              This flow has no external trigger. Invoking here bypasses its normal caller (
              <code className="font-mono text-[10px]">fx.call</code> /{" "}
              <code className="font-mono text-[10px]">effects.calls</code>
              ). The body still matches <code className="font-mono text-[10px]">flow.in</code>.
            </div>
          ) : null}
          {kind === "cdc" ? (
            <p className="px-3 pt-2.5 pb-2 text-[11px] leading-snug text-muted-foreground">
              Direct handler invoke — not a Store CDC event.
            </p>
          ) : null}

          {params.length > 0 ? (
            <section className="min-w-0" aria-label="Path params">
              <DockChapter title="Path params" hint={row.path ?? undefined} />
              {params.map((name) => (
                <SheetField key={name} label={name} className="[&>span]:px-3">
                  <Input
                    id={`path-${name}`}
                    flat
                    className={cn(SHEET_CONTROL, "px-3 font-mono")}
                    placeholder={pathParamPlaceholder(name)}
                    value={pathValues[name] ?? ""}
                    onChange={(e) => setPathValues((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                </SheetField>
              ))}
            </section>
          ) : null}

          <section className="min-w-0" aria-label="Body">
            <DockChapter
              title="Body"
              hint={bodyView === "raw" ? "raw JSON" : "seeded from schema"}
            />
            {bodyView === "raw" ? (
              <div className="border-b border-border/50">
                <textarea
                  data-slot="call-api-body-raw"
                  aria-label="Raw JSON body"
                  spellCheck={false}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    if (rawError) setRawError(null);
                  }}
                  className={cn(
                    "min-h-40 w-full resize-y rounded-none border-0 bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none",
                    "placeholder:text-muted-foreground focus-visible:bg-muted/20",
                    rawError && "text-destructive",
                  )}
                />
                {rawError ? (
                  <p
                    role="alert"
                    className="px-3 pb-2 text-xs text-destructive"
                    data-slot="call-api-raw-error"
                  >
                    {rawError}
                  </p>
                ) : null}
              </div>
            ) : fields.length === 0 ? (
              <p className="border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
                No body fields (empty object).
              </p>
            ) : (
              <SheetGrid>
                {fields.map((f) => (
                  <BodyField
                    key={f.path}
                    field={f}
                    value={body[f.name]}
                    onChange={(v) => setBody((prev) => ({ ...prev, [f.name]: v }))}
                    error={localErrors.find((e) => e.path === `/${f.name}` || e.path === f.path)}
                    wide={f.type === "object" || f.type === "array"}
                    manifest={manifest}
                  />
                ))}
              </SheetGrid>
            )}
            {localErrors.length > 0 ? (
              <p
                role="alert"
                className="px-3 py-2 text-xs text-destructive"
                data-slot="call-api-validation"
              >
                Fix contract errors before sending.
              </p>
            ) : null}
          </section>
        </div>

        <ResponseBlock
          failed={Boolean(failed)}
          success={invoke.isSuccess && !failed}
          elapsed={elapsed}
          statusCode={statusCode}
          errorMessage={invoke.isError ? (invoke.error as Error).message : null}
          responseJson={responseJson}
          emptyHint="Call to see a real host response."
          pathUsed={null}
        />
      </div>
    </CallDock>
  );
}

/**
 * Shared response chrome for invoke / run-now.
 */
function ResponseBlock({
  failed,
  success,
  elapsed,
  statusCode,
  errorMessage,
  responseJson,
  emptyHint,
  pathUsed,
}: {
  readonly failed: boolean;
  readonly success: boolean;
  readonly elapsed: number | null;
  readonly statusCode?: number;
  readonly errorMessage: string | null;
  readonly responseJson: string | null;
  readonly emptyHint: string;
  readonly pathUsed: "clock" | "invoke" | null;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const status = (
    <ResponseStatus
      failed={failed}
      success={success}
      elapsed={elapsed}
      statusCode={statusCode}
      pathUsed={pathUsed}
    />
  );

  return (
    <section
      className="flex min-h-56 min-w-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2.5"
      aria-label="Response"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Response
        </h4>
        <div className="flex items-center gap-2">
          {status}
          {responseJson ? (
            <ToolbarTip label="Expand response">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Expand response"
                data-slot="call-api-response-expand"
                className="size-5 text-muted-foreground"
                onClick={() => setExpanded(true)}
              >
                <HugeiconsIcon icon={ArrowExpand01Icon} className="size-3.5" aria-hidden />
              </Button>
            </ToolbarTip>
          ) : null}
        </div>
      </div>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive" data-slot="call-api-error">
          {errorMessage}
        </p>
      ) : null}
      {responseJson ? (
        <div
          className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-border/55 bg-muted/15"
          data-slot="call-api-response-frame"
        >
          <div className="flex min-h-0 min-w-0 flex-1">
            <div
              className={cn(
                "w-1 shrink-0 self-stretch",
                failed ? "bg-destructive" : "bg-emerald-500",
              )}
              aria-hidden
              data-slot="call-api-response-rail"
            />
            <HighlightedJson
              json={responseJson}
              dataSlot="call-api-response"
              className="flex min-h-0 flex-1 overflow-auto"
            />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
      {responseJson ? (
        <Sheet open={expanded} onOpenChange={setExpanded}>
          <SheetContent
            side="right"
            className="gap-0 p-0 data-[side=right]:w-[min(48rem,calc(100vw-2rem))] data-[side=right]:sm:max-w-[min(48rem,calc(100vw-2rem))]"
            data-slot="call-api-response-dialog"
          >
            <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-12">
              <div className="min-w-0">
                <SheetTitle className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  Response
                </SheetTitle>
                <SheetDescription className="sr-only">Full Call API response JSON</SheetDescription>
              </div>
              <div className="flex items-center gap-2">
                {status}
                <CopyInlineButton value={responseJson} label="Copy response" />
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="flex h-full min-h-0">
                <div
                  className={cn(
                    "w-1 shrink-0 self-stretch",
                    failed ? "bg-destructive" : "bg-emerald-500",
                  )}
                  aria-hidden
                />
                <HighlightedJson
                  json={responseJson}
                  dataSlot="call-api-response-expanded"
                  className="flex min-h-0 flex-1 overflow-auto"
                />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </section>
  );
}

/**
 * Status + duration chips shared by the dock and the expand dialog.
 */
function ResponseStatus({
  failed,
  success,
  elapsed,
  statusCode,
  pathUsed,
}: {
  readonly failed: boolean;
  readonly success: boolean;
  readonly elapsed: number | null;
  readonly statusCode?: number;
  readonly pathUsed: "clock" | "invoke" | null;
}): JSX.Element {
  return (
    <>
      {pathUsed ? (
        <span
          className="font-mono text-[9px] tracking-wide text-muted-foreground uppercase"
          data-slot="call-api-path-used"
          data-path={pathUsed}
        >
          via {pathUsed === "clock" ? "clock.run-now" : "flows.invoke"}
        </span>
      ) : null}
      {success || failed ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[9px] font-semibold tracking-wide uppercase",
            failed
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
          data-slot="call-api-status"
          data-failed={failed ? "true" : "false"}
        >
          <HugeiconsIcon icon={failed ? Alert02Icon : Tick02Icon} className="size-3" aria-hidden />
          {statusCode ?? (failed ? "error" : "ok")}
        </span>
      ) : null}
      {elapsed !== null ? (
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatDuration(elapsed)}
        </span>
      ) : null}
    </>
  );
}

/**
 * Flush invoke dock — toolbar + scrollable body (Units workbench).
 */
function CallDock({
  title,
  actions,
  children,
  dataTrigger,
  dataMode,
}: {
  readonly title: string;
  readonly actions: ReactNode;
  readonly children: ReactNode;
  readonly dataTrigger?: string;
  readonly dataMode?: string;
}): JSX.Element {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-slot="call-api-panel"
      data-trigger={dataTrigger}
      data-mode={dataMode}
    >
      <div className={cn(EXPLORER_TOOLBAR_CLASS, "min-w-0")}>
        <div className="flex shrink-0 items-center gap-1.5 px-2">
          <HugeiconsIcon icon={PlayIcon} className="size-3.5 text-muted-foreground" aria-hidden />
          <h3 className="text-[10px] font-semibold tracking-[0.14em] text-foreground uppercase">
            {title}
          </h3>
        </div>
        <div className="ml-auto flex h-full min-w-0 items-stretch">{actions}</div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/**
 * Compact identity picker for the dock toolbar.
 */
function IdentitySelect({
  identities,
  value,
  onChange,
}: {
  readonly identities: readonly FlowIdentity[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  return (
    <Select
      value={value || null}
      onValueChange={(next) => {
        if (next == null || Array.isArray(next)) return;
        onChange(String(next));
      }}
    >
      <SelectTrigger
        className="h-8 max-w-40 min-w-0 rounded-none border-0 bg-transparent px-2 text-[11px] shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent *:data-[slot=select-value]:truncate"
        data-slot="call-api-identity"
        aria-label="Identity"
      >
        <SelectValue placeholder="Identity…">
          {(raw) => identityTriggerLabel(identities, raw == null ? null : String(raw))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        sideOffset={4}
        className="min-w-64 p-1"
      >
        {identities.map((id) => (
          <SelectItem key={id.id} value={id.id} disabled={id.status !== "active"}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[12px] leading-tight">{id.name}</span>
              <span className="truncate text-[10px] leading-tight text-muted-foreground">
                {id.email}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Segmented Fields / Raw control — same chrome as Trace Request body toggle.
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
      className="flex h-8 shrink-0 items-center gap-2 px-2"
      role="group"
      aria-label="Body view"
      data-slot="call-api-body-view-toggle"
    >
      <BodyViewToggleButton
        active={view === "fields"}
        label="Fields"
        icon={ListViewIcon}
        onClick={() => onChange("fields")}
      />
      <BodyViewToggleButton
        active={view === "raw"}
        label="Raw"
        icon={SourceCodeIcon}
        onClick={() => onChange("raw")}
      />
    </div>
  );
}

function BodyViewToggleButton({
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
        "inline-flex h-8 items-center gap-1 rounded-none border-0 bg-transparent text-[10px] font-semibold tracking-[0.08em] uppercase shadow-none transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
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

const DOCK_TOOL =
  "h-8 rounded-none border-0 bg-transparent px-2 text-[10px] font-semibold tracking-[0.08em] uppercase shadow-none hover:bg-transparent";

const DOCK_SUBMIT =
  "h-8 rounded-none border-0 px-3 text-[10px] font-semibold tracking-[0.14em] uppercase shadow-none";

function DockSep(): JSX.Element {
  return <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />;
}

const DOCK_SELECT =
  "h-7 w-full justify-between rounded-none border-0 bg-transparent px-2 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent";

/**
 * Section eyebrow for a full-bleed dock field stack.
 */
function DockChapter({
  title,
  hint,
}: {
  readonly title: string;
  readonly hint?: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/15 px-3 py-1.5">
      <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </h4>
      {hint ? (
        <span className="text-[9px] tracking-wide text-muted-foreground/80 uppercase">{hint}</span>
      ) : null}
    </div>
  );
}

function BodyField({
  field,
  value,
  onChange,
  error,
  wide = false,
  manifest,
}: {
  readonly field: FormField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly error?: { path: string; message: string };
  readonly wide?: boolean;
  readonly manifest: Manifest | null;
}): JSX.Element {
  const id = `body-${field.name}`;
  const fk = useFkFieldOptions(field, manifest);
  const hint = [
    !field.required ? "optional" : null,
    fk.lookup ? `fk · ${fk.lookup.child}.${fk.lookup.column}` : field.type,
    !fk.lookup ? fieldConstraintHint(field) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const errorLine = error ? (
    <p className="px-3 pb-2 text-xs text-destructive">{error.message}</p>
  ) : null;
  const fieldClass = cn(wide && "col-span-full border-r-0");

  if (fk.lookup) {
    const current = value == null || value === "" ? "" : String(value);
    const options = mergeCurrentFkOption(fk.options, current);
    return (
      <SheetField label={field.name} hint={hint} dense className={fieldClass}>
        <Select
          value={current || null}
          onValueChange={(v) => {
            if (v == null || Array.isArray(v)) return;
            onChange(String(v));
          }}
        >
          <SelectTrigger id={id} className={DOCK_SELECT} disabled={fk.isLoading}>
            <SelectValue placeholder={fk.isLoading ? "Loading…" : "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorLine}
      </SheetField>
    );
  }

  if (field.type === "enum" && field.enumValues) {
    return (
      <SheetField label={field.name} hint={hint} dense className={fieldClass}>
        <Select
          value={String(value ?? "")}
          onValueChange={(v) => {
            if (v == null || Array.isArray(v)) return;
            onChange(String(v));
          }}
        >
          <SelectTrigger id={id} className={DOCK_SELECT}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.enumValues.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errorLine}
      </SheetField>
    );
  }
  if (field.type === "boolean") {
    return (
      <SheetField label={field.name} hint={hint} dense className={fieldClass}>
        <Select
          value={value === true ? "true" : "false"}
          onValueChange={(v) => {
            if (v == null || Array.isArray(v)) return;
            onChange(String(v) === "true");
          }}
        >
          <SelectTrigger id={id} className={DOCK_SELECT}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      </SheetField>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    const choices = integerSelectValues(field);
    if (choices) {
      const current = typeof value === "number" ? String(value) : "";
      return (
        <SheetField label={field.name} hint={hint} dense className={fieldClass}>
          <Select
            value={current || null}
            onValueChange={(v) => {
              if (v == null || Array.isArray(v)) return;
              onChange(Number(v));
            }}
          >
            <SelectTrigger id={id} className={DOCK_SELECT}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((n) => {
                const meaning = field.valueMeanings?.find((m) => m.value === String(n));
                return (
                  <SelectItem key={n} value={String(n)}>
                    {meaning ? `${n} · ${meaning.label}` : n}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {errorLine}
        </SheetField>
      );
    }
    return (
      <SheetField label={field.name} hint={hint} dense className={fieldClass}>
        <Input
          id={id}
          type="number"
          flat
          className={cn(SHEET_CONTROL, "h-7 px-2 font-mono")}
          min={field.minimum}
          max={field.maximum}
          step={field.type === "integer" ? 1 : undefined}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            if (e.target.value === "") {
              onChange(undefined);
              return;
            }
            onChange(clampNumber(Number(e.target.value), field.minimum, field.maximum));
          }}
        />
        {errorLine}
      </SheetField>
    );
  }
  return (
        <SheetField label={field.name} hint={hint} dense className={fieldClass}>
      <Input
        id={id}
        flat
        className={cn(SHEET_CONTROL, "h-7 px-2 font-mono")}
        value={typeof value === "string" ? value : value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
      {errorLine}
    </SheetField>
  );
}

function useFkFieldOptions(field: FormField, manifest: Manifest | null) {
  const lookup = useMemo(() => resolveFkLookup(field, manifest), [field, manifest]);
  const query = useStoreQuery(
    lookup ? { ref: lookup.ref, child: lookup.child, limit: 200 } : null,
    lookup !== null,
  );
  const options = useMemo(
    () => fkOptionsFromRows(query.data?.rows ?? [], lookup),
    [query.data?.rows, lookup],
  );
  return { lookup, options, isLoading: query.isFetching };
}

function mergeCurrentFkOption(
  options: readonly FkOption[],
  current: string,
): readonly FkOption[] {
  if (!current || options.some((opt) => opt.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}
