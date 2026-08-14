import { describe, expect, test } from "bun:test";
import type { FilesStoreFxHandle } from "../../elements/store/runtime.ts";
import {
  FILES_CATALOG_KEY,
  fileObjectRecord,
  isFilesCatalogKey,
  readFilesCatalog,
  removeFilesCatalogRecords,
  upsertFilesCatalogRecord,
} from "./files-catalog.ts";

function mockFiles(): FilesStoreFxHandle {
  const store = new Map<string, Uint8Array>();
  return {
    ref: "files:test",
    driverId: "memory",
    put: async (key, data) => {
      store.set(key, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    get: async (key) => store.get(key) ?? null,
    delete: async (key) => store.delete(key),
    list: async () => [...store.keys()],
    image: () => {
      throw new Error("unused");
    },
    putImage: async () => {
      throw new Error("unused");
    },
  } as FilesStoreFxHandle;
}

describe("files catalog", () => {
  test("hides reserved keys", () => {
    expect(isFilesCatalogKey(FILES_CATALOG_KEY)).toBe(true);
    expect(isFilesCatalogKey("attachments/note.txt")).toBe(false);
  });

  test("upsert and remove persist originalName", async () => {
    const handle = mockFiles();
    await upsertFilesCatalogRecord(
      handle,
      "attachments/des-200/file-ab12.pdf",
      fileObjectRecord("رخصة عمل.pdf", 12, "attachments/des-200/file-ab12.pdf"),
    );
    const catalog = await readFilesCatalog(handle);
    expect(catalog.objects["attachments/des-200/file-ab12.pdf"]?.originalName).toBe("رخصة عمل.pdf");
    await removeFilesCatalogRecords(handle, ["attachments/des-200/file-ab12.pdf"]);
    const empty = await readFilesCatalog(handle);
    expect(empty.objects["attachments/des-200/file-ab12.pdf"]).toBeUndefined();
  });
});
