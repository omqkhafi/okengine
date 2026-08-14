/**
 * Schema visualizer edge — smooth step + cardinality icon.
 */

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { JSX } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { schemaRelationLabel, type SchemaGraphEdge } from "../lib/schema-graph.ts";
import { SchemaRelationIcon } from "./schema-relation-icon.tsx";

/**
 * Custom React Flow edge with a relation glyph instead of `N:1` text.
 *
 * @param props - xyflow edge props
 */
export function SchemaRelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<SchemaGraphEdge>): JSX.Element {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const relation = data?.relation ?? "many-to-one";
  const column = data?.column ?? "";
  const inferred = data?.inferred === true;
  const label = `${inferred ? "Inferred" : "Declared"} ${schemaRelationLabel(relation, column)}`;
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            opacity: typeof style?.opacity === "number" ? style.opacity : 1,
          }}
        >
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <span
                  {...props}
                  aria-label={label}
                  className="flex items-center justify-center rounded-sm border border-border/60 bg-background/90 p-0.5 shadow-sm"
                >
                  <SchemaRelationIcon kind={relation} hex={data?.hex} />
                </span>
              )}
            />
            <TooltipContent side="top" className="text-[11px]">
              {label}
            </TooltipContent>
          </Tooltip>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** edgeTypes registry for the schema visualizer. */
export const schemaGraphEdgeTypes = {
  relation: SchemaRelationEdge,
};
