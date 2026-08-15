import { z } from "zod";
import { member, projectAdminWrite } from "@/core";
import { tags } from "@/db/schema.decl";
import { tagsZod } from "@/db/zod";
import { bindCrud } from "@/lib/resource";

const createIn = z.object({
  name: z.string().min(1),
  groupName: z.string().optional(),
});

export const { list, create, get, update, remove } = bindCrud({
  unit: "tags",
  path: "/tags",
  table: tags,
  read: member,
  write: projectAdminWrite,
  createIn,
  out: tagsZod.select,
  search: ["name", "groupName"],
});
