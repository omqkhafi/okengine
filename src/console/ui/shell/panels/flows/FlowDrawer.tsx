/**
 * Flow drawer — peek / workbench workshop (console §9.2).
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { confirmationFor, validateTypedConfirm } from "../../../flows/confirmation.ts";
import { diffAgainstSchema, seedFromSchema } from "../../../flows/contract.ts";
import type { FlowNode } from "../../../flows/graph.ts";
import { emitSaveAsTest, saveAsTestPath } from "../../../flows/save-as-test.ts";
import { TIER_LABEL } from "../../../flows/tiers.ts";
import { consoleCalls } from "../../client.ts";
import { Button, Field, Input } from "../../components/ui.tsx";
import { ContractEditor, validateBeforeSend } from "./ContractEditor.tsx";

/** Props for {@link FlowDrawer}. */
export interface FlowDrawerProps {
  readonly flow: FlowNode;
  readonly mode: "peek" | "workbench";
  readonly editorMode: "form" | "json";
  readonly production: boolean;
  readonly onEditorModeChange: (mode: "form" | "json") => void;
  readonly onModeChange: (mode: "peek" | "workbench") => void;
  readonly onClose: () => void;
}

/**
 * Workshop drawer for a single flow.
 *
 * @param props - Flow + modes
 */
export function FlowDrawer(props: FlowDrawerProps) {
  const { flow, mode } = props;
  const [body, setBody] = useState<unknown>(() => seedFromSchema(flow.inSchema));
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateBeforeSend>["errors"]>(
    [],
  );
  const [asUserId, setAsUserId] = useState("");
  const [confirmTyped, setConfirmTyped] = useState("");
  const [reason, setReason] = useState("");
  const [response, setResponse] = useState<unknown>(null);
  const [savedTest, setSavedTest] = useState<string | null>(null);

  useEffect(() => {
    setBody(seedFromSchema(flow.inSchema));
    setFieldErrors([]);
    setResponse(null);
    setSavedTest(null);
    setConfirmTyped("");
    setReason("");
  }, [flow.id, flow.inSchema]);

  const identities = useQuery({
    queryKey: ["console.flows.identities"],
    queryFn: async () => {
      const res = await consoleCalls.flowsIdentities();
      if (res.error) throw new Error(res.error.code);
      return res.data as {
        identities: Array<{
          id: string;
          email: string;
          name: string;
          status: string;
        }>;
      };
    },
  });

  useEffect(() => {
    const first = identities.data?.identities.find((i) => i.status === "active");
    if (first && !asUserId) setAsUserId(first.id);
  }, [identities.data, asUserId]);

  const pattern = useMemo(
    () => confirmationFor(flow.peakTier, { production: props.production }),
    [flow.peakTier, props.production],
  );

  const invoke = useMutation({
    mutationFn: async () => {
      const local = validateBeforeSend(flow.inSchema, body);
      if (!local.ok) {
        setFieldErrors(local.errors);
        throw new Error("validation");
      }
      setFieldErrors([]);

      if (pattern.kind === "typed") {
        const err = validateTypedConfirm({
          typed: confirmTyped,
          reason,
          phrase: pattern.phrase,
        });
        if (err) throw new Error("confirm");
      }

      const res = await consoleCalls.flowsInvoke({
        flowId: flow.id,
        body,
        asUserId,
        confirmation: pattern.kind === "typed" ? confirmTyped : undefined,
        reason: pattern.kind === "typed" ? reason : undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as {
        response: unknown;
        trigger: string;
        peakTier: string;
      };
    },
    onSuccess: (data) => {
      setResponse(data.response);
      if (mode === "peek") props.onModeChange("workbench");
    },
  });

  const schemaDiff = useMemo(() => {
    if (response === null) return null;
    return diffAgainstSchema(flow.outSchema, response);
  }, [response, flow.outSchema]);

  const clientLine = `await api.${flow.id}(${JSON.stringify(body)})`;

  return (
    <aside
      className={
        mode === "peek"
          ? "absolute inset-y-0 left-[min(28%,20rem)] right-[min(28%,20rem)] z-20 flex flex-col border-x border-[var(--oke-line)] bg-[var(--oke-bg)]"
          : "absolute inset-0 z-20 flex flex-col border border-[var(--oke-line)] bg-[var(--oke-bg)]"
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="flow-drawer-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--oke-line)] px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-[var(--oke-muted)]">{flow.unit}</p>
          <h2 id="flow-drawer-title" className="truncate text-lg font-semibold">
            {flow.action}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="border border-[var(--oke-line)] px-1.5 py-0.5">{flow.plane}</span>
            {flow.flags.durable ? <Flag>durable</Flag> : null}
            {flow.flags.live ? <Flag>live</Flag> : null}
            {flow.flags.external ? (
              <Flag accent>
                external <span aria-hidden="true">↗</span>
              </Flag>
            ) : null}
            {flow.deprecated ? <Flag>deprecated</Flag> : null}
          </div>
          {mode === "workbench" ? (
            <p className="text-xs text-[var(--oke-muted)]">
              Effects: {flow.peakTier === "none" ? "none" : TIER_LABEL[flow.peakTier]}
              {flow.external ? " · irreversible" : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={flow.external && props.production ? "external" : "primary"}
            onClick={() => {
              if (mode === "peek") props.onModeChange("workbench");
              invoke.mutate();
            }}
            disabled={invoke.isPending || !asUserId}
          >
            Invoke
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await navigator.clipboard.writeText(clientLine);
            }}
          >
            Copy client line
          </Button>
          {flow.source ? (
            <a
              href={`cursor://file/${flow.source}`}
              className="inline-flex min-h-8 items-center border border-[var(--oke-line)] px-3 text-sm"
            >
              Open in editor
            </a>
          ) : null}
          <Button type="button" variant="ghost" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <section aria-label="As whom" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">As whom</h3>
            <p className="text-xs text-[var(--oke-muted)]">
              Operators hold no application scopes — invoke uses{" "}
              <code className="font-mono">console:flows:invoke-as</code>.
            </p>
            <Field label="Identity">
              <select
                className="min-h-8 w-full border border-[var(--oke-line)] bg-transparent px-3 text-sm"
                value={asUserId}
                onChange={(e) => setAsUserId(e.target.value)}
              >
                <option value="">Select identity…</option>
                {(identities.data?.identities ?? []).map((id) => (
                  <option key={id.id} value={id.id} disabled={id.status !== "active"}>
                    {id.name} · {id.email}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <ContractEditor
            schema={flow.inSchema}
            value={body}
            mode={props.editorMode}
            onModeChange={props.onEditorModeChange}
            onChange={setBody}
            errors={fieldErrors}
          />

          {pattern.kind === "typed" ? (
            <section
              aria-label="Irreversible confirmation"
              className="flex flex-col gap-2 border border-[var(--oke-external)] p-3"
            >
              <p className="text-sm text-[var(--oke-external)]">
                This flow has external effects in production. Type <strong>{pattern.phrase}</strong>{" "}
                and record a reason.
              </p>
              <Field label={`Type ${pattern.phrase}`}>
                <Input
                  value={confirmTyped}
                  onChange={(e) => setConfirmTyped(e.currentTarget.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label="Reason">
                <Input value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
              </Field>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <section aria-label="Response" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Response</h3>
            {invoke.isError ? (
              <p role="alert" className="text-sm text-[var(--oke-danger)]">
                {invoke.error instanceof Error && invoke.error.message === "validation"
                  ? "Fix contract errors before sending."
                  : invoke.error instanceof Error && invoke.error.message === "confirm"
                    ? "Typed confirmation required."
                    : "Invoke failed."}
              </p>
            ) : null}
            {response !== null ? (
              <>
                <pre className="overflow-auto border border-[var(--oke-line)] p-3 font-mono text-xs">
                  {JSON.stringify(response, null, 2)}
                </pre>
                {schemaDiff && (schemaDiff.missing.length > 0 || schemaDiff.extra.length > 0) ? (
                  <p role="status" className="text-xs text-[var(--oke-danger)]">
                    Schema drift — missing: {schemaDiff.missing.join(", ") || "—"} · extra:{" "}
                    {schemaDiff.extra.join(", ") || "—"}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const contents = emitSaveAsTest({
                      flowId: flow.id,
                      request: body,
                      response,
                      asUserId,
                    });
                    setSavedTest(contents);
                    void navigator.clipboard.writeText(contents);
                  }}
                >
                  Save as test ({saveAsTestPath(flow.id)})
                </Button>
                {savedTest ? (
                  <pre className="max-h-48 overflow-auto border border-[var(--oke-line)] p-3 font-mono text-[11px]">
                    {savedTest}
                  </pre>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-[var(--oke-muted)]">
                Invoke to see a typed response and trace.
              </p>
            )}
          </section>

          {flow.errorNames.length > 0 ? (
            <section aria-label="Recent activity">
              <h3 className="mb-2 text-sm font-medium">Typed errors</h3>
              <p className="font-mono text-xs text-[var(--oke-muted)]">
                {flow.errorNames.join(" · ")}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function Flag({
  children,
  accent,
}: {
  readonly children: React.ReactNode;
  readonly accent?: boolean;
}) {
  return (
    <span
      className="border px-1.5 py-0.5"
      style={
        accent
          ? { borderColor: "var(--oke-external)", color: "var(--oke-external)" }
          : { borderColor: "var(--oke-line)" }
      }
    >
      {children}
    </span>
  );
}
