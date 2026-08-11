/**
 * Units Call API — session-authenticated invoke-as against the host.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
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
import type { UnitFlowRow } from "../lib/unit-tree.ts";

/** Props for {@link CallApiPanel}. */
export interface CallApiPanelProps {
  readonly row: UnitFlowRow;
}

/**
 * Request builder + real invoke response.
 *
 * @param props - Selected flow row
 */
export function CallApiPanel({ row }: CallApiPanelProps): JSX.Element {
  const identities = useFlowsIdentities();
  const invoke = useFlowsInvoke();
  const inSchema = schemaObject(row.flow.in);
  const fields = useMemo(() => fieldsFromSchema(inSchema), [inSchema]);
  const params = useMemo(
    () => (row.path ? pathParamNames(row.path) : []),
    [row.path],
  );

  const [asUserId, setAsUserId] = useState("");
  const [pathValues, setPathValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState<Record<string, unknown>>(
    () => (seedFromSchema(inSchema) as Record<string, unknown>) ?? {},
  );
  const [localErrors, setLocalErrors] = useState<readonly { path: string; message: string }[]>(
    [],
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    setBody((seedFromSchema(inSchema) as Record<string, unknown>) ?? {});
    setPathValues({});
    setLocalErrors([]);
    invoke.reset();
  }, [row.id]);

  useEffect(() => {
    const first = identities.data?.find((i) => i.status === "active");
    if (first && !asUserId) setAsUserId(first.id);
  }, [identities.data, asUserId]);

  async function onCall(): Promise<void> {
    const local = validateContract(inSchema, body);
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
        body,
        asUserId,
        ...(params.length > 0 ? { pathParams: pathValues } : {}),
      });
    } catch {
      // Error surface via invoke.isError
    }
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

  return (
    <div className="flex flex-col gap-4 border-t border-border/60 p-4" data-slot="call-api-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Call API
        </h3>
        <Button
          type="button"
          size="sm"
          data-slot="call-api-submit"
          disabled={invoke.isPending || !asUserId}
          onClick={() => void onCall()}
        >
          {invoke.isPending ? "Calling…" : "Call API"}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Uses your operator session. Operators hold no application scopes — invoke uses{" "}
        <code className="font-mono">console:flows:invoke-as</code>.
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
                onChange={(e) =>
                  setPathValues((prev) => ({ ...prev, [name]: e.target.value }))
                }
              />
            </Field>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-2" aria-label="Body">
        <h4 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Body
        </h4>
        {fields.length === 0 ? (
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
          {elapsed !== null ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatDuration(elapsed)}
            </span>
          ) : null}
        </div>
        {invoke.isError ? (
          <p role="alert" className="text-sm text-destructive" data-slot="call-api-error">
            {(invoke.error as Error).message}
          </p>
        ) : null}
        {responseJson ? (
          <HighlightedJson json={responseJson} dataSlot="call-api-response" />
        ) : (
          <p className="text-xs text-muted-foreground">Call API to see a real host response.</p>
        )}
      </section>
    </div>
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
  if (field.type === "enum" && field.enumValues) {
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={id}>
          {field.name}
          {field.required ? "" : "?"}
        </FieldLabel>
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
        <FieldLabel htmlFor={id}>{field.name}</FieldLabel>
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
        <FieldLabel htmlFor={id}>
          {field.name} <span className="text-muted-foreground">{field.type}</span>
        </FieldLabel>
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
      <FieldLabel htmlFor={id}>
        {field.name} <span className="text-muted-foreground">string</span>
      </FieldLabel>
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
