import { describe, expect, test } from "bun:test";
import { DevController } from "./dev-controller.ts";

describe("DevController", () => {
  test("refuses to stop an external session", async () => {
    const ctrl = new DevController();
    const errors: string[] = [];
    ctrl.on((e) => {
      if (e.type === "error") errors.push(e.message);
    });
    // Force external via attach with busy ports inject — attach uses real probe.
    // Simulate by calling stop after manually setting ownership through attach
    // against a free project with no lock: stop should be a no-op (stopped).
    await ctrl.attach(process.cwd());
    if (ctrl.getOwnership() === "stopped") {
      await ctrl.stop();
      expect(ctrl.getOwnership()).toBe("stopped");
    }
    // Direct external refusal path:
    (ctrl as unknown as { ownership: string }).ownership = "external";
    await ctrl.stop();
    expect(errors.some((m) => m.includes("refusing to stop external"))).toBe(true);
  });

  test("emit delivers events to listeners", () => {
    const ctrl = new DevController();
    const types: string[] = [];
    const off = ctrl.on((e) => types.push(e.type));
    ctrl.emit({ type: "boot", phase: "x" });
    ctrl.emit({ type: "log", text: "hi" });
    off();
    ctrl.emit({ type: "exit", code: 0 });
    expect(types).toEqual(["boot", "log"]);
  });
});
