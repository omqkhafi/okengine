/**
 * MCP tool trigger — name validation, gated registration lookup,
 * duplicate-name boot failure (OKE1018), gate posture, and Manifest stamping.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { GateBootError } from "../elements/gate/boot.ts";
import { extractFromSources } from "../compiler/extract.ts";
import { gate } from "../elements/gate.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { mcp } from "./triggers.ts";

const member = gate.policy("member", ({ auth }) => !!auth.verified);

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("mcp.tool(name)", () => {
  test("empty or missing name throws TypeError", () => {
    expect(() => mcp.tool("")).toThrow(/name is required/);
    expect(() => mcp.tool("   ")).toThrow(/name is required/);
    expect(() => (mcp.tool as (name?: string) => ReturnType<typeof mcp.tool>)()).toThrow(
      /name is required/,
    );
  });

  test("gated registration is indexed by exact tool name", () => {
    const toolFlow = on(
      mcp.tool("unit.action").gate(member),
      flow("unit.action", {
        plane: "user",
        do: () => ({ ok: true }),
      }),
    );

    expect(toolFlow.$trigger?.kind).toBe("mcp");
    expect(toolFlow.$trigger && toolFlow.$trigger.kind === "mcp" && toolFlow.$trigger.name).toBe(
      "unit.action",
    );

    const app = oke({ name: "t", autoBoot: false });
    expect(app.resolveMcpTool("unit.action")).toBe(toolFlow);
    expect(app.resolveMcpTool("other.action")).toBeUndefined();
  });

  test("duplicate tool name fails OKE1018 at construction", () => {
    on(
      mcp.tool("bookings.create").gate(member),
      flow("bookings.create", { plane: "user", do: () => ({ ok: true }) }),
    );
    on(
      mcp.tool("bookings.create").gate(member),
      flow("bookings.also", { plane: "user", do: () => ({ ok: true }) }),
    );
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1018/);
  });

  test("ungated mcp.tool passes on() but fails gate posture at boot", async () => {
    on(
      mcp.tool("bookings.create"),
      flow("bookings.create", { plane: "user", do: () => ({ ok: true }) }),
    );

    const app = oke({ name: "t", autoBoot: false });
    expect(app.resolveMcpTool("bookings.create")).toBeUndefined();
    await expect(app.boot()).rejects.toThrow(GateBootError);
  });
});

describe("mcp.tool — Manifest", () => {
  test("trigger.mcp.name and gates are stamped on the flow", async () => {
    const source = `
import { on, flow, gate, mcp } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth.verified);

export const createBooking = on(
  mcp.tool("bookings.create").gate(member),
  flow("bookings.create", {
    plane: "user",
    do: () => ({ ok: true }),
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/bookings/index.ts": source });
    const flowDef = manifest.flows?.["bookings.create"];
    expect(flowDef?.trigger).toEqual({ mcp: { name: "bookings.create" } });
    expect(flowDef?.gates).toEqual(["member"]);
    expect(flowDef?.plane).toBe("user");
  });
});
