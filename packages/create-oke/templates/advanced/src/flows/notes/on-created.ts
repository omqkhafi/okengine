import { on, flow } from "okengine/http";

import { noteCreatedMail } from "@/core";
import { noteCreated } from "./signals";

/** On create → send the note-created email template. */
export const onCreated = on(
  noteCreated,
  flow({
    do: async (payload, fx) => {
      await fx.send(noteCreatedMail, {
        to: "you@localhost",
        data: { id: payload.id, title: payload.title },
      });
    },
  }),
);
