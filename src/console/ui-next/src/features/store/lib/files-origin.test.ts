import { describe, expect, test } from "bun:test";
import type { StoreListStore } from "@/client.ts";
import {
  filesDriverLabel,
  filesDriverOrigin,
  isSingletonFilesBucket,
} from "./files-origin.ts";

const emptyWillNot = {
  writerFlowIds: [] as string[],
  signals: [] as string[],
  channels: [] as string[],
};

const emptyCache = {
  producedByRead: "computed:files:attachments",
  invalidatedByWrites: [] as string[],
  invalidatingFlowIds: [] as string[],
};

function filesStore(
  extras: Partial<StoreListStore> & Pick<StoreListStore, "name" | "children">,
): StoreListStore {
  return {
    ref: `files:${extras.name}`,
    facet: "files",
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: true,
    warnings: [],
    ...extras,
  };
}

function bucket(name: string) {
  return {
    name,
    effectRef: `files:${name}`,
    writers: [],
    readers: [],
    cache: emptyCache,
    willNotFire: emptyWillNot,
    piiColumns: [],
    columnDescriptions: {},
  };
}

describe("isSingletonFilesBucket", () => {
  test("true when the only child shares the store name", () => {
    expect(
      isSingletonFilesBucket(filesStore({ name: "attachments", children: [bucket("attachments")] })),
    ).toBe(true);
  });

  test("false when the store has several buckets", () => {
    expect(
      isSingletonFilesBucket(
        filesStore({ name: "uploads", children: [bucket("avatars"), bucket("exports")] }),
      ),
    ).toBe(false);
  });
});

describe("files driver copy", () => {
  test("labels the three files drivers", () => {
    expect(filesDriverLabel("memory")).toBe("memory");
    expect(filesDriverOrigin("memory")).toBe("This process");
    expect(filesDriverOrigin("fs")).toBe("Local disk");
    expect(filesDriverOrigin("s3")).toBe("Object store");
  });
});
