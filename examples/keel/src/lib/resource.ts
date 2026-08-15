import { on, flow, http, fail, type GateDecl } from "okengine";
import { z } from "zod";
import { db } from "@/core";
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
 * Handwritten CRUD for schema tables. `store.resource` cannot resolve
 * tables whose `name` column shadows the table name.
 *
 * @param spec - Unit, path, table, gates, create defaults
 */
export function bindNamedTableCrud(spec: {
  readonly unit: string;
  readonly path: string;
  readonly table: unknown;
  readonly read: readonly GateDecl[];
  readonly write: readonly GateDecl[];
  readonly liveList?: boolean;
  readonly defaults?: Record<string, unknown>;
}): CrudBag {
  const { unit, path, table, read, write } = spec;
  const item = `${path}/:id`;
  const listTrigger = spec.liveList
    ? http.get(path).gate(...read).live()
    : http.get(path).gate(...read);

  const list = on(
    listTrigger,
    flow(`${unit}.list`, {
      in: z.object({
        q: z.string().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }),
      out: z.object({ items: z.array(z.record(z.string(), z.unknown())), count: z.number() }),
      do: async (input, fx) => {
        const rows = (await fx.store(db).select().from(table)) as Record<string, unknown>[];
        let items = rows;
        if (input.q) {
          const q = input.q.toLowerCase();
          items = rows.filter((r) =>
            Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
          );
        }
        const limit = input.limit ?? 25;
        const offset = input.offset ?? 0;
        const page = items.slice(offset, offset + limit);
        return { items: page, count: items.length };
      },
    }),
  );

  const create = on(
    http.post(path).gate(...write),
    flow(`${unit}.create`, {
      in: z.record(z.string(), z.unknown()),
      out: z.object({ id: z.string() }),
      do: async (input, fx) => {
        const id = typeof input.id === "string" && input.id.length > 0 ? input.id : fx.id();
        await fx.store(db).insert(table).values({ ...(spec.defaults ?? {}), ...input, id });
        return { id };
      },
    }),
  );

  const get = on(
    http.get(item).gate(...read),
    flow(`${unit}.get`, {
      in: IdIn,
      out: z.record(z.string(), z.unknown()),
      errors: { NotFound },
      do: async (input, fx) => {
        const row = await fx.store(db).findById(table, input.id);
        if (!row) return fail("NotFound", { id: input.id });
        return row as Record<string, unknown>;
      },
    }),
  );

  const update = on(
    http.patch(item).gate(...write),
    flow(`${unit}.update`, {
      in: z.record(z.string(), z.unknown()).and(IdIn),
      out: z.object({ id: z.string() }),
      errors: { NotFound },
      do: async (input, fx) => {
        const row = await fx.store(db).findById(table, input.id);
        if (!row) return fail("NotFound", { id: input.id });
        const { id, ...patch } = input;
        if (Object.keys(patch).length > 0) {
          await fx.store(db).update(table).set(patch).where({ id } as never);
        }
        return { id };
      },
    }),
  );

  const remove = on(
    http.delete(item).gate(...write),
    flow(`${unit}.delete`, {
      in: IdIn,
      out: Ok,
      errors: { NotFound },
      do: async (input, fx) => {
        const row = await fx.store(db).findById(table, input.id);
        if (!row) return fail("NotFound", { id: input.id });
        await fx.store(db).delete(table).where({ id: input.id } as never);
        return { ok: true as const };
      },
    }),
  );

  return { list, create, get, update, remove };
}
