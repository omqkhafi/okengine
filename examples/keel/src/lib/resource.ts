import { on, flow, http, fail, store, type GateAllDecl, type GateDecl } from "okengine";
import { z } from "zod";
import { db } from "@/core";
import { listIn, pageOut, queryPage } from "@/lib/http";
import { IdIn, NotFound, Ok } from "@/lib/shapes";

/** Bound CRUD exports. */
export type CrudBag = {
  readonly list: unknown;
  readonly create: unknown;
  readonly get: unknown;
  readonly update: unknown;
  readonly remove: unknown;
};

/**
 * `sql:<table>` for a `store.schema.table` handle.
 *
 * @param table - Declared table
 */
function sqlRefForTable(table: unknown): `sql:${string}` | undefined {
  if (typeof table !== "object" || table === null) return undefined;
  const row = table as { kind?: unknown; tableName?: unknown; name?: unknown };
  const name =
    row.kind === "schema-table" && typeof row.tableName === "string"
      ? row.tableName
      : typeof row.name === "string"
        ? row.name
        : undefined;
  return name === undefined ? undefined : (`sql:${name}` as const);
}

/**
 * Named CRUD via `store.resource` paging plus explicit `unit.op` flow names.
 *
 * `http.resource` + `store.resource` name flows `list`/`create` — colliding
 * across units — so we bind each verb ourselves. Stamps `sql:<table>` so the
 * kernel cache cycle (read → fill, write → invalidate) runs without extract.
 *
 * @param spec - Unit, path, table, gates, schemas
 */
export function bindCrud(spec: {
  readonly unit: string;
  readonly path: string;
  readonly table: unknown;
  readonly read: GateAllDecl | GateDecl | readonly GateDecl[];
  readonly write: GateAllDecl | GateDecl | readonly GateDecl[];
  readonly createIn: z.ZodType;
  readonly out: z.ZodType;
  readonly updateIn?: z.ZodType;
  readonly defaults?: Record<string, unknown>;
  readonly search?: readonly string[];
  /** Skip the POST create binding (caller supplies a richer create). */
  readonly skipCreate?: boolean;
}): CrudBag {
  const { unit, path, table, read, write } = spec;
  const item = `${path}/:id`;
  const tableRef = sqlRefForTable(table);
  const readFx = tableRef ? { reads: [tableRef] } : undefined;
  const writeFx = tableRef ? { writes: [tableRef] } : undefined;
  const bothFx = tableRef ? { reads: [tableRef], writes: [tableRef] } : undefined;
  const listTrigger = http.get(path).gate(read);
  const resource = store.resource(db, table, {
    in: spec.createIn,
    out: spec.out,
    update: spec.updateIn ?? spec.createIn,
    list: {
      mode: "offset",
      search: "all",
      filter: "all",
      order: "all",
    },
  });

  const list = on(
    listTrigger,
    flow(`${unit}.list`, {
      in: listIn({ mode: "offset" }),
      out: pageOut(spec.out),
      effects: readFx,
      do: async (input, fx) => {
        const pageOpts = resource.page(input);
        const rows = await fx.store(db).page(table, pageOpts);
        return fx.json.with(
          queryPage(rows as Record<string, unknown>[], input, {
            mode: "offset",
            search: spec.search ?? ["name"],
            filter: "all",
            order: "all",
            select: "all",
          }),
        );
      },
    }),
  );

  const create = spec.skipCreate
    ? undefined
    : on(
        http.post(path).gate(write),
        flow(`${unit}.create`, {
          in: spec.createIn,
          out: z.object({ id: z.string() }),
          effects: writeFx,
          do: async (input, fx) => {
            const id = fx.id();
            await fx
              .store(db)
              .insert(table)
              .values({ ...(spec.defaults ?? {}), ...(input as Record<string, unknown>), id });
            return { id };
          },
        }),
      );

  const get = on(
    http.get(item).gate(read),
    flow(`${unit}.get`, {
      in: IdIn,
      out: spec.out,
      errors: { NotFound },
      effects: readFx,
      do: async (input, fx) => {
        const row = await fx.store(db).findById(table, input.id);
        if (!row) return fail("NotFound", { id: input.id });
        return row as Record<string, unknown>;
      },
    }),
  );

  const update = on(
    http.patch(item).gate(write),
    flow(`${unit}.update`, {
      in: z.intersection(IdIn, spec.updateIn ?? spec.createIn),
      out: z.object({ id: z.string() }),
      errors: { NotFound },
      effects: bothFx,
      do: async (input, fx) => {
        const row = await fx.store(db).findById(table, input.id);
        if (!row) return fail("NotFound", { id: input.id });
        const { id, ...patch } = input as Record<string, unknown> & { id: string };
        if (Object.keys(patch).length > 0) {
          await fx
            .store(db)
            .update(table)
            .set(patch)
            .where({ id } as never);
        }
        return { id };
      },
    }),
  );

  const remove = on(
    http.delete(item).gate(write),
    flow(`${unit}.delete`, {
      in: IdIn,
      out: Ok,
      errors: { NotFound },
      effects: bothFx,
      do: async (input, fx) => {
        const row = await fx.store(db).findById(table, input.id);
        if (!row) return fail("NotFound", { id: input.id });
        await fx
          .store(db)
          .delete(table)
          .where({ id: input.id } as never);
        return { ok: true as const };
      },
    }),
  );

  return { list, create: create ?? list, get, update, remove };
}
