/**
 * Units Call API — session-authenticated invoke-as against the host.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import {
  Alert02Icon,
  ArrowReloadHorizontalIcon,
  ListViewIcon,
  Loading03Icon,
  PlayIcon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HighlightedJson } from "@/components/highlighted-json";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/features/flows/traces/format-duration.ts";
import { useFlowsIdentities, useFlowsInvoke } from "../data/use-flows-invoke.ts";
import {
  fieldsFromSchema,
  schemaObject,
  seedFromSchema,
  type FormField,
} from "../lib/fields-from-schema.ts";
import { pathParamNames } from "../lib/path-params.ts";
import { validateContract } from "../lib/validate-contract.ts";
import { schemaTypeBadgeClass } from "../lib/schema-type-visual.ts";
import type { UnitFlowRow } from "../lib/unit-tree.ts";

/** Props for {@link CallApiPanel}. */
export interface CallApiPanelProps {
  readonly row: UnitFlowRow;
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
 * Request builder + real invoke response — the interactive action zone.
 *
 * @param props - Selected flow row
 */
export function CallApiPanel({ row }: CallApiPanelProps): JSX.Element {
  const identities = useFlowsIdentities();
  const invoke = useFlowsInvoke();
  const inSchema = schemaObject(row.flow.in);
  const fields = useMemo(() => fieldsFromSchema(inSchema), [inSchema]);
  const params = useMemo(() => (row.path ? pathParamNames(row.path) : []), [row.path]);

  const [asUserId, setAsUserId] = useState("");
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
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
    setPathValues({});
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
    setPathValues({});
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

  return (
    <div className="p-4 pt-0" data-slot="call-api-panel">
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
        {/* Action-zone header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className="flex size-6 items-center justify-center rounded-md border border-foreground/15 bg-background text-foreground"
              aria-hidden
            >
              <HugeiconsIcon icon={PlayIcon} className="size-3" />
            </span>
            <h3 className="text-[10px] font-semibold tracking-[0.14em] text-foreground/85 uppercase">
              Call API
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <BodyViewToggle view={bodyView} onChange={onBodyViewChange} />
            <Tooltip>
              <TooltipTrigger
                render={(props) => (
                  <Button
                    {...props}
                    type="button"
                    variant="ghost"
                    size="xs"
                    data-slot="call-api-reset"
                    disabled={invoke.isPending}
                    onClick={onReset}
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
            <Button
              type="button"
              size="sm"
              data-slot="call-api-submit"
              disabled={invoke.isPending || !asUserId}
              onClick={() => void onCall()}
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
                  Call API
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-3.5">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Uses your operator session. Operators hold no application scopes — invoke uses{" "}
            <code className="rounded bg-muted/50 px-1 py-px font-mono text-[10px]">
              console:flows:invoke-as
            </code>
            .
          </p>

          <Field>
            <FieldLabel>Identity</FieldLabel>
            <Select
              value={asUserId || null}
              onValueChange={(value) => {
                if (value == null || Array.isArray(value)) return;
                setAsUserId(String(value));
              }}
            >
              <SelectTrigger className="h-8" data-slot="call-api-identity">
                <SelectValue placeholder="Select identity…" />
              </SelectTrigger>
              <SelectContent>
                {(identities.data ?? []).map((id) => (
                  <SelectItem key={id.id} value={id.id} disabled={id.status !== "active"}>
                    {id.name} · {id.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {params.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label="Path params">
              <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Path params
              </h4>
              {params.map((name) => (
                <Field key={name}>
                  <FieldLabel htmlFor={`path-${name}`}>{name}</FieldLabel>
                  <Input
                    id={`path-${name}`}
                    className="h-8 font-mono"
                    value={pathValues[name] ?? ""}
                    onChange={(e) => setPathValues((prev) => ({ ...prev, [name]: e.target.value }))}
                  />
                </Field>
              ))}
            </section>
          ) : null}

          <section className="flex flex-col gap-2.5" aria-label="Body">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Body
              </h4>
              <span className="text-[9px] tracking-wide text-muted-foreground/80 uppercase">
                {bodyView === "raw" ? "raw JSON" : "seeded from schema"}
              </span>
            </div>
            {bodyView === "raw" ? (
              <div className="flex flex-col gap-1.5">
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
                    "min-h-40 w-full resize-y rounded-md border border-border/55 bg-muted/15 px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors",
                    "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    rawError && "border-destructive",
                  )}
                />
                {rawError ? (
                  <p role="alert" className="text-xs text-destructive" data-slot="call-api-raw-error">
                    {rawError}
                  </p>
                ) : null}
              </div>
            ) : fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">No body fields (empty object).</p>
            ) : (
              fields.map((f) => (
                <BodyField
                  key={f.path}
                  field={f}
                  value={body[f.name]}
                  onChange={(v) => setBody((prev) => ({ ...prev, [f.name]: v }))}
                  error={localErrors.find((e) => e.path === `/${f.name}` || e.path === f.path)}
                />
              ))
            )}
            {localErrors.length > 0 ? (
              <p role="alert" className="text-xs text-destructive" data-slot="call-api-validation">
                Fix contract errors before sending.
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2" aria-label="Response">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Response
              </h4>
              <div className="flex items-center gap-2">
                {invoke.isSuccess ? (
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
                    <HugeiconsIcon
                      icon={failed ? Alert02Icon : Tick02Icon}
                      className="size-3"
                      aria-hidden
                    />
                    {statusCode ?? (failed ? "error" : "ok")}
                  </span>
                ) : null}
                {elapsed !== null ? (
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {formatDuration(elapsed)}
                  </span>
                ) : null}
              </div>
            </div>
            {invoke.isError ? (
              <p role="alert" className="text-sm text-destructive" data-slot="call-api-error">
                {(invoke.error as Error).message}
              </p>
            ) : null}
            {responseJson ? (
              <div
                className="overflow-hidden rounded-md border border-border/55 bg-muted/15"
                data-slot="call-api-response-frame"
              >
                <div className="flex min-w-0">
                  <div
                    className={cn(
                      "w-1 shrink-0 self-stretch",
                      failed ? "bg-destructive" : "bg-emerald-500",
                    )}
                    aria-hidden
                    data-slot="call-api-response-rail"
                  />
                  <div className="min-w-0 flex-1">
                    <HighlightedJson json={responseJson} dataSlot="call-api-response" />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Call API to see a real host response.</p>
            )}
          </section>
        </div>
      </div>
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
      className="flex shrink-0 items-center rounded-md border border-border/60 bg-background/60 p-0.5"
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

function BodyField({
  field,
  value,
  onChange,
  error,
}: {
  readonly field: FormField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly error?: { path: string; message: string };
}): JSX.Element {
  const id = `body-${field.name}`;

  const typeBadge = (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-px font-mono text-[9px] font-medium tracking-wide",
        schemaTypeBadgeClass(field.type),
      )}
    >
      {field.type}
    </span>
  );
  const optionalPill = !field.required ? (
    <span className="shrink-0 rounded border border-border/60 bg-muted/30 px-1 py-px text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
      optional
    </span>
  ) : null;

  const label = (
    <FieldLabel htmlFor={id} className="items-center">
      <span className="font-mono text-[11px] font-medium">{field.name}</span>
      {optionalPill}
      {typeBadge}
    </FieldLabel>
  );

  if (field.type === "enum" && field.enumValues) {
    return (
      <Field data-invalid={error ? true : undefined}>
        {label}
        <Select
          value={String(value ?? "")}
          onValueChange={(v) => {
            if (v == null || Array.isArray(v)) return;
            onChange(String(v));
          }}
        >
          <SelectTrigger id={id} className="h-8">
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
        {error ? <FieldError>{error.message}</FieldError> : null}
      </Field>
    );
  }
  if (field.type === "boolean") {
    return (
      <Field>
        {label}
        <Select
          value={value === true ? "true" : "false"}
          onValueChange={(v) => {
            if (v == null || Array.isArray(v)) return;
            onChange(String(v) === "true");
          }}
        >
          <SelectTrigger id={id} className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return (
      <Field data-invalid={error ? true : undefined}>
        {label}
        <Input
          id={id}
          type="number"
          className="h-8 font-mono"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const n = e.target.value === "" ? undefined : Number(e.target.value);
            onChange(n);
          }}
        />
        {error ? <FieldError>{error.message}</FieldError> : null}
      </Field>
    );
  }
  return (
    <Field data-invalid={error ? true : undefined}>
      {label}
      <Input
        id={id}
        className="h-8 font-mono"
        value={typeof value === "string" ? value : value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <FieldError>{error.message}</FieldError> : null}
    </Field>
  );
}
