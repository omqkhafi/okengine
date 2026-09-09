/**
 * `call(name, opts)` — call-only Flow sugar with invoke contract on the bag.
 *
 * Same species as `flow` + internal trigger; contracts live here (not on `flow()`).
 */

import {
  stampBoundaryContract,
  type BoundaryContract,
  type InferBoundaryErrors,
  type InferBoundaryIn,
  type InferBoundaryOut,
} from "./boundary-contract.ts";
import {
  flow,
  type FlowDef,
  type FlowErrorMap,
  type FlowHandler,
  type FlowOptions,
} from "./flow.ts";
import { internal } from "./triggers.ts";

/** Options for {@link call} — boundary contract + flow runtime + `do`. */
export type CallOptions<
  I = unknown,
  O = unknown,
  E extends FlowErrorMap = FlowErrorMap,
> = BoundaryContract<unknown, unknown, E> &
  Omit<FlowOptions<I, O>, "do"> & {
    readonly do: FlowHandler<I, O>;
  };

type InferCallIn<Opts> = Opts extends { readonly in: unknown }
  ? InferBoundaryIn<Opts>
  : Opts extends { readonly do: FlowHandler<infer I, infer _O> }
    ? I
    : unknown;

type InferCallOut<Opts> = Opts extends { readonly out: unknown }
  ? InferBoundaryOut<Opts>
  : Opts extends { readonly do: FlowHandler<infer _I, infer O> }
    ? O
    : unknown;

/**
 * Define a call-only Flow with its invoke contract on the same bag.
 *
 * @param name - Stable Manifest / `fx.call` name
 * @param options - Contract + runtime + `do`
 */
export function call<Opts extends CallOptions<any, any, any>>(
  name: string,
  options: Opts & { readonly name?: never },
): FlowDef<InferCallIn<Opts>, InferCallOut<Opts>, InferBoundaryErrors<Opts>> {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new TypeError("call(name, opts): name is required");
  }
  const {
    in: inSchema,
    out: outSchema,
    errors,
    breaking,
    do: handler,
    ...runtime
  } = options as CallOptions<any, any, any>;

  const def = flow(name, {
    ...runtime,
    do: handler as FlowHandler,
  }) as FlowDef<InferCallIn<Opts>, InferCallOut<Opts>, InferBoundaryErrors<Opts>>;

  const stamped = stampBoundaryContract({
    in: inSchema,
    out: outSchema,
    errors,
    breaking,
  });
  def.in = stamped.in;
  def.out = stamped.out;
  def.errors = stamped.errors as InferBoundaryErrors<Opts> | undefined;
  def.breaking = stamped.breaking;

  // Mark as internal / call-only exposure (addressable trigger kind).
  const triggers = def.triggers as import("./triggers.ts").Trigger[];
  triggers.push(internal);
  (def as { $trigger: typeof internal }).$trigger = internal;

  return def;
}
