import { member } from "@/core";
import { customerRequests } from "@/db/schema.decl";
import { bindNamedTableCrud } from "@/lib/resource";

export const { list, create, get, update, remove } = bindNamedTableCrud({
  unit: "requests",
  path: "/customer-requests",
  table: customerRequests,
  read: [member],
  write: [member],
});
