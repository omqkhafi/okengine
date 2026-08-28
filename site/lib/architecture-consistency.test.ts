/**
 * Automated architecture & positioning consistency gate tests.
 *
 * Enforces non-negotiable invariants:
 * 1. Exactly eight closed elements (Flow, Signal, Store, Clock, Gate, Vault, Channel, AI).
 * 2. Canonical positioning, category, and philosophy statements.
 * 3. Exact four dev ports (:6530, :6533, :6535, :6536).
 * 4. Rejection of forbidden tropes ("Bun backend framework" as category, "ninth element").
 */

import { describe, expect, it } from "bun:test";
import {
  CANONICAL_EFFECTS,
  CANONICAL_ELEMENTS,
  CANONICAL_PORTS,
  COMPOSITION_PROOFS,
  DERIVED_SURFACES_CATALOG,
  TAXONOMY_RULES,
} from "./concept-graph";
import { ELEMENTS, EXPORTS, PORTS } from "./elements";
import {
  SITE_CATEGORY,
  SITE_DESCRIPTION,
  SITE_INSPECTABILITY,
  SITE_MANIFEST_DISTINCTION,
  SITE_NAME,
  SITE_PHILOSOPHY,
  SITE_TAGLINE,
  SITE_TAXONOMY_EQUATION,
} from "./site-identity";

describe("Architecture & Positioning Consistency Gate", () => {
  it("enforces exactly eight closed elements", () => {
    expect(CANONICAL_ELEMENTS.length).toBe(8);
    expect(ELEMENTS.length).toBe(8);

    const expectedNames = ["Flow", "Signal", "Store", "Clock", "Gate", "Vault", "Channel", "AI"];

    const actualNames = CANONICAL_ELEMENTS.map((e) => e.name);
    expect(actualNames).toEqual(expectedNames);
  });

  it("enforces canonical category and positioning invariants", () => {
    expect(SITE_NAME).toBe("okengine");
    expect(SITE_CATEGORY).toBe("A new programming model for backends.");
    expect(SITE_TAGLINE).toBe("One law. Eight elements. One contract.");
    expect(SITE_PHILOSOPHY).toBe(
      "Keep the model small. Let the backend grow without growing the mental model.",
    );
    expect(SITE_INSPECTABILITY).toBe("Your backend is not just executable. It is inspectable.");
    expect(SITE_TAXONOMY_EQUATION).toBe(
      "Elements define the model. Plugins extend the model's capabilities. Drivers connect the model to infrastructure. Providers and Recipes choose where that infrastructure runs.",
    );
    expect(SITE_MANIFEST_DISTINCTION).toBe(
      "The source of truth is the backend model expressed in code. The Manifest is the compiled, versioned contract representing that model. Operational surfaces are derived, not separately maintained.",
    );
    expect(SITE_DESCRIPTION).toContain("A new programming model for backends.");
  });

  it("enforces the ten core programming vocabulary exports", () => {
    expect(EXPORTS.length).toBe(10);
    const names = EXPORTS.map((e) => e.name);
    expect(names).toEqual([
      "on",
      "flow",
      "signal",
      "store",
      "clock",
      "gate",
      "vault",
      "channel",
      "ai",
      "plugin",
    ]);
  });

  it("enforces the four canonical dev ports", () => {
    expect(CANONICAL_PORTS.length).toBe(4);
    expect(PORTS.length).toBe(4);

    const portMap = new Map(CANONICAL_PORTS.map((p) => [p.port, p.name]));
    expect(portMap.get("6530")).toBe("Backend");
    expect(portMap.get("6533")).toBe("Console");
    expect(portMap.get("6535")).toBe("Runtime MCP");
    expect(portMap.get("6536")).toBe("Docs MCP");
  });

  it("enforces the four composition proofs", () => {
    expect(COMPOSITION_PROOFS.length).toBe(4);
    const proofIds = COMPOSITION_PROOFS.map((p) => p.id);
    expect(proofIds).toEqual(["realtime", "security", "agents", "operations"]);
  });

  it("enforces observable effects definition", () => {
    expect(CANONICAL_EFFECTS.length).toBe(7);
    const kinds = CANONICAL_EFFECTS.map((e) => e.kind);
    expect(kinds).toEqual(["read", "write", "emit", "send", "ask", "secret", "call"]);
  });

  it("enforces derived surfaces catalog", () => {
    expect(DERIVED_SURFACES_CATALOG.length).toBe(6);
    const ids = DERIVED_SURFACES_CATALOG.map((s) => s.id);
    expect(ids).toContain("client");
    expect(ids).toContain("console");
    expect(ids).toContain("mcp-runtime");
    expect(ids).toContain("mcp-docs");
    expect(ids).toContain("specs");
    expect(ids).toContain("capabilities");
  });

  it("enforces taxonomy rules distinguishing elements, plugins, drivers, providers, recipes", () => {
    expect(TAXONOMY_RULES.element).toContain("8 closed core primitives");
    expect(TAXONOMY_RULES.plugin).toContain("Extends what the model can do");
    expect(TAXONOMY_RULES.driver).toContain("connecting an element to infrastructure");
    expect(TAXONOMY_RULES.provider).toContain("Managed/cloud infrastructure");
    expect(TAXONOMY_RULES.recipe).toContain("Self-hosted Docker/compose");
  });
});
