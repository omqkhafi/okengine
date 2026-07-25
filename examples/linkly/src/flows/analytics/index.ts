import { z } from "zod";
import { member } from "../../gates";
import { on, flow, http } from "okengine";
import { linkClicked } from "../links/signals";
import { db } from "../../core";
import { daily } from "../../schema";

on(linkClicked, flow({                    // a second consumer of the same signal
  do: ({ code, at }, fx) => fx.store(db).bumpDaily(daily, code, at),
}));

export const report = on(http.get("/links/:code/report").gate(member), flow({
  out: z.array(z.object({ day: z.string(), clicks: z.number() })),
  do: ({ code }, fx) => fx.store(db).dailyFor(daily, code),
}));
