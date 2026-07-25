import { on, flow, http } from "okengine";
import { member } from "../../gates";
import { UserProfile } from "./shapes";

export const me = on(
  http.get("/me").gate(member),
  flow({
    name: "users.me",
    out: UserProfile,
    do: (_input, fx) => ({ id: fx.auth.userId ?? "anon" }),
  }),
);
