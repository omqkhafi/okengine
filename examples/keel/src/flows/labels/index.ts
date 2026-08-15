import { issueWrite, labelsWriteRate, member } from "@/core";
import { labels } from "@/db/schema.decl";
import { bindNamedTableCrud } from "@/lib/resource";

export const { list, create, get, update, remove } = bindNamedTableCrud({
  unit: "labels",
  path: "/labels",
  table: labels,
  read: [member],
  write: [member, issueWrite, labelsWriteRate],
});
