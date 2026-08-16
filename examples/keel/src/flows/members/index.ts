import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, member, memberAdminWrite } from "@/core";
import { members, spaces } from "@/db/schema.decl";
import { membersZod } from "@/db/zod";
import { IdOut, NotFound } from "@/lib/shapes";
import { bindCrud } from "@/lib/resource";

const createIn = z.object({
  email: z.string().min(1),
  role: z.string().min(1),
  name: z.string().optional(),
  spaceId: z.string().optional(),
});

export const { list, get, update, remove } = bindCrud({
  unit: "members",
  path: "/members",
  table: members,
  read: member,
  write: memberAdminWrite,
  createIn,
  out: membersZod.select,
  skipCreate: true,
  search: ["name", "email", "role"],
});

const InviteIn = z.object({
  email: z.string().min(1),
  role: z.string().min(1),
  spaceId: z.string().optional(),
});

/** Invite a member. */
export const invite = on(
  http.post("/members/invite").gate(memberAdminWrite),
  flow("members.invite", {
    in: InviteIn,
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      if (input.spaceId) {
        const space = await fx.store(db).findById(spaces, input.spaceId);
        if (!space) return fail("NotFound", { id: input.spaceId });
      }
      const id = fx.id();
      await fx
        .store(db)
        .insert(members)
        .values({
          id,
          spaceId: input.spaceId ?? null,
          name: input.email.split("@")[0] ?? input.email,
          email: input.email,
          role: input.role,
        });
      return { id };
    },
  }),
);
