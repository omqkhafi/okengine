import { gate } from "okengine";

/** Verified member. */
export const member = gate.policy("member", ({ auth }) => !!auth?.verified);
