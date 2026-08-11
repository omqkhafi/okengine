/**
 * Units contract detail — endpoint + schemas + errors + gates + effects.
 */

import type { JSX } from "react";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { GateList } from "@/components/gate-list";
import { HttpMethodBadge } from "@/components/http-method-badge";
import { Badge } from "@/components/ui/badge";
import { traceGateInfos } from "@/features/flows/traces/trace-gates.ts";
import { traceRequestMeta } from "@/features/flows/traces/request-meta.ts";
import type { UnitFlowRow } from "../lib/unit-tree.ts";
import { fieldsFromSchema, schemaObject } from "../lib/fields-from-schema.ts";
import { EffectsSummary } from "./effects-summary.tsx";
import { ErrorsSection } from "./errors-section.tsx";
import { SchemaFields } from "./schema-fields.tsx";

/** Props for {@link FlowContractPanel}. */
export interface FlowContractPanelProps {
  readonly row: UnitFlowRow;
  readonly manifest: Manifest | null;
}

/**
 * Top detail pane for a selected flow.
 *
 * @param props - Flow row + Manifest
 */
export function FlowContractPanel({ row, manifest }: FlowContractPanelProps): JSX.Element {
  const meta = traceRequestMeta(manifest, row.id, row.flow.trigger?.http ? "http" : "internal");
  const inSchema = schemaObject(row.flow.in);
  const outSchema = schemaObject(row.flow.out);
  const gates = traceGateInfos(row.flow.gates ?? [], manifest);

  return (
    <div className="flex flex-col gap-4 p-4" data-slot="flow-contract-panel">
      <header className="flex flex-col gap-2" data-slot="endpoint-header">
        <div className="flex flex-wrap items-center gap-2">
          {meta.method ? <HttpMethodBadge method={meta.method} /> : null}
          <code className="font-mono text-sm text-foreground">
            {meta.path ?? meta.headline}
          </code>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
        <div className="flex flex-wrap gap-1.5">
          {row.flow.plane ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              {row.flow.plane}
            </Badge>
          ) : null}
          {row.flow.durable ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              durable
            </Badge>
          ) : null}
          {row.flow.live ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              live
            </Badge>
          ) : null}
        </div>
      </header>

      <section className="flex flex-col gap-2" aria-label="Request">
        <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Request
        </h3>
        <SchemaFields
          fields={fieldsFromSchema(inSchema)}
          emptyLabel={
            typeof row.flow.in === "string"
              ? "Schema not expanded in Manifest."
              : "No request schema declared."
          }
        />
      </section>

      <section className="flex flex-col gap-2" aria-label="Response">
        <h3 className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Response
        </h3>
        <SchemaFields
          fields={fieldsFromSchema(outSchema)}
          emptyLabel={
            typeof row.flow.out === "string"
              ? "Schema not expanded in Manifest."
              : "No response schema declared."
          }
        />
      </section>

      <ErrorsSection errors={row.flow.errors} />
      <GateList gates={gates} />
      <EffectsSummary effects={row.flow.effects} />
    </div>
  );
}
