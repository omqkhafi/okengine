/**
 * Units Call API — trigger-aware action zone (invoke / run-now).
 */

import { useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import {
  Alert02Icon,
  ArrowExpand01Icon,
  ArrowReloadHorizontalIcon,
  Cancel01Icon,
  Copy01Icon,
  ListViewIcon,
  Loading03Icon,
  PlayIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import {
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_STRIP_CLASS,
  EXPLORER_STRIP_TOKEN_ACTIVE_CLASS,
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
  EXPLORER_TOOLBAR_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { HighlightedJson } from "@/components/highlighted-json";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
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
import { CallIdentityMenu, callInvokeAsReady, type CallInvokeAs } from "./call-identity-menu.tsx";
import { CallPiiButton } from "./call-pii-button.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RunCache } from "@/features/flows/traces/cache-icon.ts";
import { CacheGlyph } from "@/features/flows/traces/cache-glyph.tsx";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import { httpMethodHasBody } from "@/features/flows/traces/http-method.ts";
import { useStoreQuery } from "@/features/store/data/use-store-query.ts";
import { useClockRunNow, useFlowsIdentities, useFlowsInvoke } from "../data/use-flows-invoke.ts";
import { pickSeedFields, splitCallApiInput } from "../lib/contract-input.ts";
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
import { callTiming } from "../lib/call-timing.ts";
import { formatCallApiResponseJson, formatInvokeResponseJson } from "../lib/invoke-response.ts";
import { shouldRefetchCallOnPiiReveal } from "../lib/call-read-safe.ts";
import { validateContract } from "../lib/validate-contract.ts";
import type { UnitFlowRow } from "../lib/unit-tree.ts";
import { piiFieldNamesFromManifest } from "../../../../../../console/server/runs-pii.ts";

/** Props for {@link CallApiPanel}. */
export interface CallApiPanelProps {
  readonly row: UnitFlowRow;
  readonly manifest: Manifest | null;
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
  const [invokeAs, setInvokeAs] = useState<CallInvokeAs>({ asGate: null, asUserId: null });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pathUsed, setPathUsed] = useState<"clock" | "invoke" | null>(null);

  useEffect(() => {
    clockRun.reset();
    invoke.reset();
    setPathUsed(null);
    setStartedAt(null);
  }, [row.id]);

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
    if (!callInvokeAsReady(invokeAs)) return;
    setPathUsed("invoke");
    try {
      await invoke.mutateAsync({
        flowId: row.id,
        body: {},
        ...(invokeAs.asUserId ? { asUserId: invokeAs.asUserId } : {}),
        ...(invokeAs.asGate ? { asGate: invokeAs.asGate } : {}),
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
      return formatInvokeResponseJson(invoke.data);
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
              <CallIdentityMenu
                manifest={manifest}
                identities={identities.data ?? []}
                value={invokeAs}
                onChange={setInvokeAs}
              />
              <DockSep />
            </>
          ) : null}
          <Button
            type="button"
            data-slot="call-api-submit"
            disabled={pending || (!matched && !callInvokeAsReady(invokeAs))}
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
          handlerMs={matched ? null : invoke.data?.durationMs}
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
          cache={matched ? undefined : invoke.data?.cache}
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
  const split = useMemo(
    () =>
      splitCallApiInput(fields, {
        http: kind === "http",
        method: row.method,
        pathParams: params,
      }),
    [fields, kind, row.method, params],
  );
  const showBody = kind !== "http" || httpMethodHasBody(row.method);

  const [invokeAs, setInvokeAs] = useState<CallInvokeAs>({ asGate: null, asUserId: null });
  const [piiMasked, setPiiMasked] = useState(true);
  const [pathValues, setPathValues] = useState<Record<string, string>>(() =>
    seedPathValues(row.path, params),
  );
  const seedAll = useMemo(
    () => (seedFromSchema(inSchema) as Record<string, unknown>) ?? {},
    [inSchema],
  );
  const seedQuery = useMemo(() => pickSeedFields(seedAll, split.query), [seedAll, split.query]);
  const seedBody = useMemo(() => pickSeedFields(seedAll, split.body), [seedAll, split.body]);
  const [query, setQuery] = useState<Record<string, unknown>>(seedQuery);
  const [body, setBody] = useState<Record<string, unknown>>(seedBody);
  const [bodyView, setBodyView] = useState<BodyView>("fields");
  const [rawText, setRawText] = useState(() => stringifyBody(seedBody));
  const [rawError, setRawError] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<readonly { path: string; message: string }[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    setQuery(seedQuery);
    setBody(seedBody);
    setRawText(stringifyBody(seedBody));
    setRawError(null);
    setBodyView("fields");
    setPathValues(seedPathValues(row.path, params));
    setLocalErrors([]);
    setElapsedMs(null);
    setStartedAt(null);
    invoke.reset();
  }, [row.id]);

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

  async function onCall(includePii = !piiMasked): Promise<void> {
    let nextBody = showBody ? body : {};
    if (showBody && bodyView === "raw") {
      if (!commitRawText(rawText)) return;
      try {
        nextBody = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        return;
      }
    }
    const invokeBody = { ...query, ...nextBody };
    const local = validateContract(inSchema, { ...pathValues, ...invokeBody });
    if (!local.ok) {
      setLocalErrors(local.errors);
      return;
    }
    setLocalErrors([]);
    if (!callInvokeAsReady(invokeAs)) return;
    setStartedAt(performance.now());
    try {
      await invoke.mutateAsync({
        flowId: row.id,
        body: invokeBody,
        ...(invokeAs.asUserId ? { asUserId: invokeAs.asUserId } : {}),
        ...(invokeAs.asGate ? { asGate: invokeAs.asGate } : {}),
        ...(params.length > 0 ? { pathParams: pathValues } : {}),
        ...(includePii ? { revealPii: true } : {}),
      });
    } catch {
      // Error surface via invoke.isError
    }
  }

  function onReset(): void {
    setQuery(seedQuery);
    setBody(seedBody);
    setRawText(stringifyBody(seedBody));
    setRawError(null);
    setPathValues(seedPathValues(row.path, params));
    setLocalErrors([]);
  }

  useEffect(() => {
    if (startedAt === null || invoke.isPending) return;
    if (invoke.isSuccess || invoke.isError) {
      setElapsedMs(performance.now() - startedAt);
    }
  }, [invoke.isSuccess, invoke.isError, invoke.isPending, startedAt]);

  const responseJson = useMemo(() => {
    if (!invoke.data) return null;
    return formatCallApiResponseJson(invoke.data, piiMasked, piiFieldNamesFromManifest(manifest));
  }, [invoke.data, piiMasked, manifest]);

  const failed = invoke.data?.failure != null;
  const statusCode = invoke.data?.status;
  const actionTitle = kind === "http" ? "Call API" : kind === "signal" ? "Run handler" : "Invoke";
  const submitLabel = actionTitle;

  return (
    <CallDock
      title={actionTitle}
      dataTrigger={kind}
      actions={
        <>
          <CallIdentityMenu
            manifest={manifest}
            identities={identities.data ?? []}
            value={invokeAs}
            onChange={setInvokeAs}
          />
          <CallPiiButton
            piiMasked={piiMasked}
            disabled={invoke.isPending}
            onToggle={() => {
              const nextMasked = !piiMasked;
              setPiiMasked(nextMasked);
              if (
                invoke.data &&
                !invoke.isPending &&
                shouldRefetchCallOnPiiReveal(row, nextMasked)
              ) {
                void onCall(true);
              }
            }}
          />
          {showBody ? (
            <>
              <DockSep />
              <BodyViewToggle view={bodyView} onChange={onBodyViewChange} />
            </>
          ) : null}
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
              {showBody ? "Reset body to the schema example" : "Reset to schema examples"}
            </TooltipContent>
          </Tooltip>
          <DockSep />
          <Button
            type="button"
            data-slot="call-api-submit"
            disabled={invoke.isPending || !callInvokeAsReady(invokeAs)}
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
            <section className="min-w-0" aria-label="Path params" data-slot="call-api-path">
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

          {split.query.length > 0 ? (
            <section className="min-w-0" aria-label="Query params" data-slot="call-api-query">
              <DockChapter title="Query params" hint="seeded from schema" />
              <SheetGrid>
                {split.query.map((f) => (
                  <BodyField
                    key={f.path}
                    field={f}
                    idPrefix="query"
                    value={query[f.name]}
                    onChange={(v) => setQuery((prev) => ({ ...prev, [f.name]: v }))}
                    error={localErrors.find((e) => e.path === `/${f.name}` || e.path === f.path)}
                    wide={f.type === "object" || f.type === "array"}
                    manifest={manifest}
                  />
                ))}
              </SheetGrid>
            </section>
          ) : null}

          {showBody ? (
            <section className="min-w-0" aria-label="Body" data-slot="call-api-body">
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
              ) : split.body.length === 0 ? (
                <p className="border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
                  No body fields (empty object).
                </p>
              ) : (
                <SheetGrid>
                  {split.body.map((f) => (
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
            </section>
          ) : null}
          {localErrors.length > 0 ? (
            <p
              role="alert"
              className="px-3 py-2 text-xs text-destructive"
              data-slot="call-api-validation"
            >
              Fix contract errors before sending.
            </p>
          ) : null}
        </div>

        <ResponseBlock
          failed={Boolean(failed)}
          success={Boolean(invoke.data) && !failed}
          elapsed={elapsedMs}
          handlerMs={invoke.data?.durationMs}
          statusCode={statusCode}
          errorMessage={invoke.isError ? (invoke.error as Error).message : null}
          responseJson={responseJson}
          emptyHint="Call to see a real host response."
          pathUsed={null}
          cache={invoke.data?.cache}
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
  handlerMs,
  statusCode,
  errorMessage,
  responseJson,
  emptyHint,
  pathUsed,
  cache,
}: {
  readonly failed: boolean;
  readonly success: boolean;
  readonly elapsed: number | null;
  readonly handlerMs?: number | null;
  readonly statusCode?: number;
  readonly errorMessage: string | null;
  readonly responseJson: string | null;
  readonly emptyHint: string;
  readonly pathUsed: "clock" | "invoke" | null;
  readonly cache?: RunCache;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const status = (
    <ResponseStatus
      failed={failed}
      success={success}
      elapsed={elapsed}
      handlerMs={handlerMs}
      statusCode={statusCode}
      pathUsed={pathUsed}
      cache={cache}
    />
  );

  return (
    <section
      className="flex min-h-56 min-w-0 flex-1 flex-col overflow-hidden"
      aria-label="Response"
      data-slot="call-api-response-block"
    >
      <div className={EXPLORER_STRIP_CLASS}>
        <h4 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>Response</h4>
        <div className="ml-auto flex h-full items-stretch">
          {status}
          {responseJson ? (
            <ToolbarTip label="Expand response" className="flex self-stretch">
              <button
                type="button"
                aria-label="Expand response"
                data-slot="call-api-response-expand"
                className={EXPLORER_ICON_BUTTON_CLASS}
                onClick={() => setExpanded(true)}
              >
                <HugeiconsIcon icon={ArrowExpand01Icon} className="size-3.5" aria-hidden />
              </button>
            </ToolbarTip>
          ) : null}
        </div>
      </div>
      {errorMessage ? (
        <p role="alert" className="px-2 py-2 text-sm text-destructive" data-slot="call-api-error">
          {errorMessage}
        </p>
      ) : null}
      {responseJson ? (
        <div className="flex min-h-0 flex-1 overflow-hidden" data-slot="call-api-response-frame">
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
      ) : (
        <p className="px-2 py-3 text-xs text-muted-foreground">{emptyHint}</p>
      )}
      {responseJson ? (
        <Sheet open={expanded} onOpenChange={setExpanded}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="gap-0 p-0 data-[side=right]:w-[min(48rem,calc(100vw-2rem))] data-[side=right]:sm:max-w-[min(48rem,calc(100vw-2rem))]"
            data-slot="call-api-response-dialog"
          >
            <SheetHeader
              className={cn(EXPLORER_STRIP_CLASS, "flex-row gap-0 border-border/60 p-0")}
            >
              <SheetTitle className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>
                Response
              </SheetTitle>
              <SheetDescription className="sr-only">Full Call API response JSON</SheetDescription>
              <div className="ml-auto flex h-full items-stretch">
                {status}
                <ResponseSheetCopy json={responseJson} />
                <span className="w-px shrink-0 self-stretch bg-border/60" aria-hidden />
                <SheetClose
                  aria-label="Close"
                  className={EXPLORER_ICON_BUTTON_CLASS}
                  data-slot="call-api-response-close"
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" aria-hidden />
                  <span className="sr-only">Close</span>
                </SheetClose>
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
 * Stretch copy token for the expanded Response sheet header.
 *
 * @param props - JSON payload
 */
function ResponseSheetCopy({ json }: { readonly json: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <ToolbarTip label={copied ? "Copied" : "Copy response"} className="flex self-stretch">
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy response"}
        data-slot="call-api-response-copy"
        className={EXPLORER_ICON_BUTTON_CLASS}
        onClick={() => {
          if (!navigator.clipboard) return;
          void navigator.clipboard.writeText(json).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-3.5" aria-hidden />
      </button>
    </ToolbarTip>
  );
}

/**
 * Status + duration tokens shared by the dock and the expand dialog.
 */
function ResponseStatus({
  failed,
  success,
  elapsed,
  handlerMs,
  statusCode,
  pathUsed,
  cache,
}: {
  readonly failed: boolean;
  readonly success: boolean;
  readonly elapsed: number | null;
  readonly handlerMs?: number | null;
  readonly statusCode?: number;
  readonly pathUsed: "clock" | "invoke" | null;
  readonly cache?: RunCache;
}): JSX.Element {
  const settled = success || failed;
  const timing = settled ? callTiming({ handlerMs, rttMs: elapsed }) : null;
  return (
    <>
      {pathUsed ? (
        <span
          className="flex h-full items-center px-2 font-mono text-[10px] text-muted-foreground"
          data-slot="call-api-path-used"
          data-path={pathUsed}
        >
          via {pathUsed === "clock" ? "clock.run-now" : "flows.invoke"}
        </span>
      ) : null}
      {settled ? (
        <span
          className={cn(
            "inline-flex h-full items-center gap-1 px-2 font-mono text-[10px] font-semibold",
            failed ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
          )}
          data-slot="call-api-status"
          data-failed={failed ? "true" : "false"}
        >
          <HugeiconsIcon icon={failed ? Alert02Icon : Tick02Icon} className="size-3" aria-hidden />
          {statusCode ?? (failed ? "error" : "ok")}
        </span>
      ) : null}
      {settled ? (
        <span className="flex h-full items-center px-2">
          <CacheGlyph cache={cache ?? "none"} dataSlot="call-api-cache" />
        </span>
      ) : null}
      {timing ? (
        <Tooltip>
          <TooltipTrigger
            render={(props) => (
              <span
                {...props}
                className="flex h-full items-center px-2 font-mono text-[10px] tabular-nums text-muted-foreground"
                data-slot="call-api-duration"
                data-kind={timing.primaryKind}
              >
                {formatDuration(timing.primaryMs)}
              </span>
            )}
          />
          <TooltipContent side="bottom" className="max-w-xs text-[11px]">
            {timing.primaryKind === "handler"
              ? "Handler time — same clock as Traces."
              : "Browser round-trip. Handler time is on the Traces row."}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {timing?.primaryKind === "handler" && timing.rttMs !== null ? (
        <span
          className="flex h-full items-center px-2 font-mono text-[10px] tabular-nums text-muted-foreground/70"
          data-slot="call-api-rtt"
          title="Browser round-trip"
        >
          {formatDuration(timing.rttMs)} rtt
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
          <h3 className={cn(SECTION_HEAD_CLASS, "text-foreground")}>{title}</h3>
        </div>
        <div className="ml-auto flex h-full min-w-0 items-stretch">{actions}</div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
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
      className="flex h-full shrink-0 items-stretch"
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

const DOCK_TOOL =
  "h-full rounded-none border-0 bg-transparent px-2 text-[10px] font-semibold tracking-[0.08em] uppercase shadow-none hover:bg-muted/50";

const DOCK_SUBMIT =
  "h-full rounded-none border-0 px-3 text-[10px] font-semibold tracking-[0.14em] uppercase shadow-none";

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
    <div className={EXPLORER_STRIP_CLASS}>
      <h4 className={cn(SECTION_HEAD_CLASS, "flex items-center px-2")}>{title}</h4>
      {hint ? (
        <span className="ml-auto flex items-center px-2 text-[10px] text-muted-foreground">
          {hint}
        </span>
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
  idPrefix = "body",
}: {
  readonly field: FormField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly error?: { path: string; message: string };
  readonly wide?: boolean;
  readonly manifest: Manifest | null;
  readonly idPrefix?: string;
}): JSX.Element {
  const id = `${idPrefix}-${field.name}`;
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

function mergeCurrentFkOption(options: readonly FkOption[], current: string): readonly FkOption[] {
  if (!current || options.some((opt) => opt.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}
