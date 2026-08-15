import { member, teamAdmin } from "@/core";
import { teams } from "@/db/schema.decl";
import { bindNamedTableCrud } from "@/lib/resource";

export const { list, create, get, update, remove } = bindNamedTableCrud({
  unit: "teams",
  path: "/teams",
  table: teams,
  read: [member],
  write: [member, teamAdmin],
  liveList: true,
});
