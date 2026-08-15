import { member, projectAdmin } from "@/core";
import { initiatives } from "@/db/schema.decl";
import { bindNamedTableCrud } from "@/lib/resource";

export const { list, create, get, update, remove } = bindNamedTableCrud({
  unit: "initiatives",
  path: "/initiatives",
  table: initiatives,
  read: [member],
  write: [member, projectAdmin],
  defaults: { status: "active" },
});
