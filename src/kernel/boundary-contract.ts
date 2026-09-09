/**
 * Shared invoke-boundary contract — authored on HTTP / call / MCP exposures,
 * projected onto Manifest `flows.*.{in,out,errors,breaking}`.
 *
 * Distinct from Signal/Channel **emit schema** (payload in motion).
 */

import type { InferSchemaOutput, SchemaInput } from "../validation/standard-schema.ts";
import type { FlowErrorMap } from "./flow.ts";

/** Invoke contract bag shared by `http.*`, `call`, and `mcp.tool`. */
export interface BoundaryContract<
  ISchema = SchemaInput,
  OSchema = SchemaInput,
  E extends FlowErrorMap = FlowErrorMap,
> {
  /** Request / args schema (Standard Schema). */
  readonly in?: ISchema;
  /** Success reply schema (Manifest + typed client; not runtime-validated). */
  readonly out?: OSchema;
  /** Typed domain errors (`fx.fail`). */
  readonly errors?: E;
  /**
   * Acknowledge intentional Manifest contract breaks for the bound flow
   * (`oke doctor --diff` / CI gate).
   */
  readonly breaking?: boolean;
}

/** Infer validated input from a {@link BoundaryContract} bag. */
export type InferBoundaryIn<Bag> = Bag extends { readonly in: infer S }
  ? InferSchemaOutput<S>
  : unknown;

/** Infer success output from a {@link BoundaryContract} bag. */
export type InferBoundaryOut<Bag> = Bag extends { readonly out: infer S }
  ? InferSchemaOutput<S>
  : unknown;

/** Infer error map from a {@link BoundaryContract} bag. */
export type InferBoundaryErrors<Bag> = Bag extends {
  readonly errors: infer E extends FlowErrorMap;
}
  ? E
  : {};

/** Runtime fields stamped onto a Flow from an exposure bag. */
export interface StampedBoundaryContract {
  readonly in: SchemaInput | undefined;
  readonly out: SchemaInput | undefined;
  readonly errors: FlowErrorMap | undefined;
  readonly breaking: boolean;
}

/**
 * Normalize an optional contract bag into stampable fields.
 *
 * @param bag - Exposure contract (may be undefined / partial)
 */
export function stampBoundaryContract(
  bag: BoundaryContract | undefined | null,
): StampedBoundaryContract {
  if (bag == null) {
    return { in: undefined, out: undefined, errors: undefined, breaking: false };
  }
  return {
    in: bag.in as SchemaInput | undefined,
    out: bag.out as SchemaInput | undefined,
    errors: bag.errors,
    breaking: bag.breaking ?? false,
  };
}

/**
 * Apply a stamped contract onto a flow carrier (runtime mutation).
 *
 * @param flow - Flow definition object
 * @param stamped - Normalized contract fields
 */
export function applyBoundaryContract(
  flow: {
    in: SchemaInput | undefined;
    out: SchemaInput | undefined;
    errors: FlowErrorMap | undefined;
    breaking: boolean;
  },
  stamped: StampedBoundaryContract,
): void {
  flow.in = stamped.in;
  flow.out = stamped.out;
  flow.errors = stamped.errors;
  if (stamped.breaking) flow.breaking = true;
}
