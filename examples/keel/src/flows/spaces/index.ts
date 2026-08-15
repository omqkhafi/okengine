import { z } from "zod";
import { member, projectAdminWrite } from "@/core";
import { spaces } from "@/db/schema.decl";
import { spacesZod } from "@/db/zod";
import { bindCrud } from "@/lib/resource";

const createIn = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  color: z.string().optional(),
});

export const { list, create, get, update, remove } = bindCrud({
  unit: "spaces",
  path: "/spaces",
  table: spaces,
  read: member,
  write: projectAdminWrite,
  liveList: true,
  createIn,
  out: spacesZod.select,
  search: ["key", "name"],
});
