import { oke } from "okengine";
import * as hello from "./flows/hello";

export const app = oke({ name: "hello" }).adopt({ hello });

export type App = typeof app;

Object.assign(app.$options, {
  env: "test",
});
