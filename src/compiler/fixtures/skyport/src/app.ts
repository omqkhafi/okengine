import { oke } from "okengine";
import "./flows/bookings/index.ts";
import "./flows/payments/index.ts";
import "./flows/support/index.ts";
import "./ai.ts";
import "./channels.ts";
import "./gates.ts";
import "./journeys.ts";

export const app = oke({ name: "skyport" });
