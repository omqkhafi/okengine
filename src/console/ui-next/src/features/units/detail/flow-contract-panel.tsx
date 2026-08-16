/**
 * Flows contract briefing — identity, activity, effects, gates, errors, schemas, validation.
 */

import type { JSX, ReactNode } from "react";
import {
  InternetAntenna03Icon,
  SecurityCheckIcon,
  Timer01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import type { Manifest, Signal } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { DetailHeader } from "@/components/explorer/detail-header.tsx";
import {
  EXPLORER_STRIP_TOKEN_CLASS,
  EXPLORER_STRIP_TOKEN_IDLE_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { SectionHead } from "@/components/explorer/section-head.tsx";
import { GateList } from "@/components/gate-list";
import { HttpMethodBadge } from "@/components/http-method-badge";
import { SignalDeliveryBadge } from "@/components/signal-delivery-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { callersOfFlow } from "@/features/flows/graph/build-flow-graph.ts";
import { traceGateInfos } from "@/features/flows/traces/trace-gates.ts";
import { traceRequestMeta } from "@/features/flows/traces/request-meta.ts";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { cn } from "@/lib/utils.ts";
import type { UnitFlowRow } from "../lib/unit-tree.ts";
import { splitContractInput } from "../lib/contract-input.ts";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";
import { flowTriggerKind, flowTriggerSpec } from "../lib/flow-trigger.ts";
import { pathParamNames } from "../lib/path-params.ts";
import { resolveClockForFlow } from "../lib/resolve-clock.ts";
import { EffectsSummary } from "./effects-summary.tsx";
import { ErrorsSection } from "./errors-section.tsx";
import { FlowActivityStrip } from "./flow-activity-strip.tsx";
import { SchemaFields } from "./schema-fields.tsx";
import { ValidationSection } from "./validation-section.tsx";

/** Props for {@link FlowContractPanel}. */
export interface FlowContractPanelProps {
  readonly row: UnitFlowRow;
  readonly manifest: Manifest | null;
  /** Live runs buffer (Flows live hookup); may be undefined while loading. */
  readonly runs?: readonly RunRow[];
  /** Start-panel collapse control for the Flows catalog. */
  readonly leading?: ReactNode;
}

/**
 * Top inspector pane for a selected flow.
 *
 * @param props - Flow row + Manifest + optional runs buffer + tree toggle
 */
export function FlowContractPanel({
  row,
  manifest,
  runs,
  leading,
}: FlowContractPanelProps): JSX.Element {
  const kind = flowTriggerKind(row.flow.trigger);
  const trigger = flowTriggerSpec(row.flow.trigger);
  const meta = traceRequestMeta(
    manifest,
    row.id,
    kind === "http" ? "http" : kind === "internal" ? "internal" : kind,
  );
  const inSchema = schemaObject(row.flow.in);
  const outSchema = schemaObject(row.flow.out);
  const gates = traceGateInfos(row.flow.gates ?? [], manifest);
  const signalDecl: Signal | undefined =
    kind === "signal" && row.flow.trigger?.signal
      ? manifest?.signals?.[row.flow.trigger.signal]
      : undefined;
  const clockMatch =
    kind === "cron" || kind === "every" ? resolveClockForFlow(manifest, row.id) : null;
  const callers = kind === "internal" ? callersOfFlow(manifest, row.id) : [];
  const inputLabel = kind === "http" ? "Request" : "Input";
  const outputLabel = kind === "http" ? "Response" : "Output";
  const showInput = kind !== "cron" && kind !== "every";
  const inputFields = fieldsFromSchema(inSchema);
  const outputFields = fieldsFromSchema(outSchema);
  const pathParams = kind === "http" && row.path ? pathParamNames(row.path) : [];
  const inputSplit = splitContractInput(inputFields, pathParams);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-slot="flow-contract-panel"
      data-trigger={kind}
    >
      <DetailHeader
        dataSlot="endpoint-header"
        leading={leading}
        icon={
          <span data-slot="trigger-kind-icon" data-kind={kind}>
            <HugeiconsIcon icon={trigger.icon} className="size-4" />
          </span>
        }
        wellClassName={trigger.wellClass}
        title={<span className="font-mono">{row.id}</span>}
        badge={
          <span
            className="font-mono text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase"
            data-slot="trigger-kind-badge"
          >
            {trigger.label}
          </span>
        }
        subtitle={
          kind === "http" && meta.method && meta.path ? (
            <span className="flex min-w-0 items-center gap-2" data-slot="http-endpoint-line">
              <HttpMethodBadge method={meta.method} />
              <code className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground select-all">
                {meta.path}
              </code>
            </span>
          ) : kind === "signal" && signalDecl ? (
            <span className="flex min-w-0 items-center gap-2" data-slot="signal-endpoint-line">
              <SignalDeliveryBadge delivery={signalDecl.delivery} />
              <code className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground select-all">
                {row.flow.trigger?.signal}
              </code>
            </span>
          ) : (
            <span
              className="truncate font-mono text-[11px] leading-none text-muted-foreground"
              data-slot="trigger-headline"
            >
              {meta.headline}
            </span>
          )
        }
        actions={
          <Link
            to="/overview"
            search={{ flow: row.id }}
            data-slot="open-in-graph"
            className={cn(EXPLORER_STRIP_TOKEN_CLASS, "text-sky-700 dark:text-sky-400")}
          >
            <HugeiconsIcon icon={ELEMENT_ICONS.flow.icon} className="size-3.5" aria-hidden />
            Open in graph
          </Link>
        }
      />

      <FlowActivityStrip flowId={row.id} runs={runs}>
        {row.flow.plane ? <PlaneBadge plane={row.flow.plane} /> : null}
        {row.flow.durable ? (
          <MetaPill
            icon={Timer01Icon}
            label="durable"
            title="Durable — long-running, retryable steps"
          />
        ) : null}
        {row.flow.live ? (
          <MetaPill
            icon={InternetAntenna03Icon}
            label="live"
            title="Live — subscribes to realtime updates"
          />
        ) : null}
      </FlowActivityStrip>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-4">
          <EffectsSummary effects={row.flow.effects} />
          <GateList gates={gates} />
          <ErrorsSection errors={row.flow.errors} />
          {kind === "signal" &&
          signalDecl &&
          (signalDecl.retries !== undefined || signalDecl.deadLetter) ? (
            <p className="text-[11px] text-muted-foreground" data-slot="signal-delivery">
              {[
                signalDecl.retries !== undefined ? `retries ${signalDecl.retries}` : null,
                signalDecl.deadLetter ? "dead-letter" : null,
              ]
                .filter((part): part is string => part !== null)
                .join(" · ")}
            </p>
          ) : null}
          {(kind === "cron" || kind === "every") && clockMatch?.kind === "matched" ? (
            <p className="text-[11px] text-muted-foreground" data-slot="clock-join">
              Clock · <span className="font-mono">{clockMatch.clockName}</span>
              {clockMatch.timezone ? ` · ${clockMatch.timezone}` : ""}
            </p>
          ) : null}
          {kind === "internal" ? (
            <p className="text-[11px] text-muted-foreground" data-slot="call-only-note">
              No external trigger — reachable via <code className="font-mono">effects.calls</code> /{" "}
              <code className="font-mono">fx.call</code>.
            </p>
          ) : null}

          {kind === "internal" ? (
            <section
              className="flex flex-col gap-1.5"
              aria-label="Callers"
              data-slot="callers-list"
            >
              <SectionHead title="Called by" meta={String(callers.length)} />
              {callers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No Manifest caller declares <code className="font-mono">effects.calls</code> for
                  this flow.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {callers.map((id) => (
                    <li key={id} className="font-mono text-xs text-foreground/90">
                      {id}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {showInput && inputSplit.parameters.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label="Parameters" data-slot="parameters">
              <SectionHead title="Parameters" meta={String(inputSplit.parameters.length)} />
              <SchemaFields fields={inputSplit.parameters} layout="grid" />
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {showInput && (inputSplit.fields.length > 0 || inputSplit.parameters.length === 0) ? (
              <section className="flex flex-col gap-2" aria-label={inputLabel} data-slot="request">
                <SectionHead title={inputLabel} meta={String(inputSplit.fields.length)} />
                <SchemaFields
                  fields={inputSplit.fields}
                  emptyLabel={
                    typeof row.flow.in === "string"
                      ? "Schema not expanded in Manifest."
                      : kind === "signal"
                        ? "No flow input schema — signal payload shape lives on the signal when declared."
                        : "No input schema declared."
                  }
                />
              </section>
            ) : null}
            <section className="flex flex-col gap-2" aria-label={outputLabel}>
              <SectionHead title={outputLabel} meta={String(outputFields.length)} />
              <SchemaFields
                fields={outputFields}
                emptyLabel={
                  typeof row.flow.out === "string"
                    ? "Schema not expanded in Manifest."
                    : "No output schema declared."
                }
              />
            </section>
          </div>

          {showInput ? <ValidationSection fields={inputFields} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Plane badge — `user` (application identity) vs `operator` (Console).
 *
 * @param props - Manifest flow.plane
 */
function PlaneBadge({ plane }: { readonly plane: string }): JSX.Element {
  const operator = plane === "operator";
  const icon = operator ? SecurityCheckIcon : UserIcon;
  const label = operator ? "operator" : "user";
  const tip = operator
    ? "Operator plane — runs under a Console operator identity, not an application user."
    : "User plane — runs under an application user identity (invoke-as).";
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={cn(EXPLORER_STRIP_TOKEN_CLASS, "cursor-help")}
            data-slot="plane-badge"
            data-plane={plane}
          >
            <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
            {label}
          </span>
        )}
      />
      <TooltipContent side="bottom" className="max-w-xs text-[11px]">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Small flagged-capability pill (durable / live) with a tooltip.
 *
 * @param props - Icon + label + tooltip text
 */
function MetaPill({
  icon,
  label,
  title,
}: {
  readonly icon: typeof Timer01Icon;
  readonly label: string;
  readonly title: string;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span
            {...props}
            className={cn(
              EXPLORER_STRIP_TOKEN_CLASS,
              EXPLORER_STRIP_TOKEN_IDLE_CLASS,
              "cursor-help",
            )}
          >
            <HugeiconsIcon icon={icon} className="size-3" aria-hidden />
            {label}
          </span>
        )}
      />
      <TooltipContent side="bottom" className="max-w-xs text-[11px]">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}
