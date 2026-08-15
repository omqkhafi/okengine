import { describe, expect, test } from "bun:test";
import { member } from "@/core";
import { documents } from "@/db/schema.decl";
import { bindCrud } from "@/lib/resource";
import { z } from "zod";

const Out = z.object({ id: z.string() });

describe("bindCrud", () => {
  test("names unit.op flows and stamps sql:<table> for the cache cycle", () => {
    const crud = bindCrud({
      unit: "documents",
      path: "/documents",
      table: documents,
      read: member,
      write: member,
      createIn: Out,
      out: Out,
    });
    const list = crud.list as { name: string; effects?: { reads?: string[] } };
    const create = crud.create as { name: string; effects?: { writes?: string[] } };
    const get = crud.get as { name: string; effects?: { reads?: string[] } };
    const update = crud.update as { name: string; effects?: unknown };
    const remove = crud.remove as { name: string; effects?: unknown };

    expect(list.name).toBe("documents.list");
    expect(create.name).toBe("documents.create");
    expect(get.name).toBe("documents.get");
    expect(update.name).toBe("documents.update");
    expect(remove.name).toBe("documents.delete");
    expect(list.effects).toEqual({ reads: ["sql:documents"] });
    expect(create.effects).toEqual({ writes: ["sql:documents"] });
    expect(get.effects).toEqual({ reads: ["sql:documents"] });
    expect(update.effects).toEqual({ reads: ["sql:documents"], writes: ["sql:documents"] });
    expect(remove.effects).toEqual({ reads: ["sql:documents"], writes: ["sql:documents"] });
  });
});
