/**
 * HTTP path param names and empty-field holders.
 */

import { describe, expect, test } from "bun:test";
import {
  pathParamExample,
  pathParamNames,
  pathParamPlaceholder,
  seedPathValues,
} from "./path-params.ts";

describe("pathParamNames", () => {
  test("pulls :tokens from a route", () => {
    expect(pathParamNames("/issues/:id")).toEqual(["id"]);
    expect(pathParamNames("/issues/:id/comments/:commentId")).toEqual(["id", "commentId"]);
    expect(pathParamNames("/issues")).toEqual([]);
  });
});

describe("pathParamPlaceholder", () => {
  test("holds the route token", () => {
    expect(pathParamPlaceholder("id")).toBe(":id");
  });
});

describe("pathParamExample", () => {
  test("prefills keel seed ids from the preceding segment", () => {
    expect(pathParamExample("/attachments/:id", "id")).toBe("attachments/ENG-184/spec.pdf");
    expect(pathParamExample("/issues/:id", "id")).toBe("iss_eng_184");
    expect(pathParamExample("/issues/:id/labels/:labelId", "labelId")).toBe("lab_feature");
    expect(pathParamExample("/unknown/:id", "id")).toBeUndefined();
  });
});

describe("seedPathValues", () => {
  test("fills known params and skips the rest", () => {
    expect(seedPathValues("/attachments/:id", ["id"])).toEqual({
      id: "attachments/ENG-184/spec.pdf",
    });
    expect(seedPathValues("/nope/:id", ["id"])).toEqual({});
  });
});
