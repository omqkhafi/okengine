import { on, flow, http, fail } from "okengine";
import { z } from "zod";

import { db, member, memberAdmin } from "@/core";
import { members, teams } from "@/db/schema.decl";
import { IdOut, NotFound } from "@/lib/shapes";
import { bindNamedTableCrud } from "@/lib/resource";

const bound = bindNamedTableCrud({
  unit: "members",
  path: "/members",
  table: members,
  read: [member],
  write: [member, memberAdmin],
});

export const list = bound.list;
export const get = bound.get;
export const update = bound.update;
export const remove = bound.remove;

const InviteIn = z.object({
  email: z.string().min(1),
  role: z.string().min(1),
  teamId: z.string().optional(),
});

/** Invite a member (skips resource create). */
export const invite = on(
  http.post("/members/invite").gate(member, memberAdmin),
  flow("members.invite", {
    in: InviteIn,
    out: IdOut,
    errors: { NotFound },
    do: async (input, fx) => {
      if (input.teamId) {
        const team = await fx.store(db).findById(teams, input.teamId);
        if (!team) return fail("NotFound", { id: input.teamId });
      }
      const id = fx.id();
      await fx.store(db).insert(members).values({
        id,
        teamId: input.teamId ?? "team_eng",
        name: input.email.split("@")[0] ?? input.email,
        email: input.email,
        role: input.role,
      });
      return { id };
    },
  }),
);
