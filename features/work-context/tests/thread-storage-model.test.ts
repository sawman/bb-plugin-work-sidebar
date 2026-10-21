import { describe, expect, it } from "vitest";
import { projectStorageListing, safeStoragePath, STORAGE_ENTRY_LIMIT } from "../thread-storage-model";

describe("bounded thread storage metadata projection", () => {
  it("rejects traversal, absolute and malformed targets while preserving native-safe literal names", () => {
    for (const path of ["", "/root/file", "../file", "a/../file", "./file", "a//b", "a/", "C:/file", "C:file", "a\\b", "a\u0000b", "a\nb", "a\ud800b"]) {
      expect(safeStoragePath(path), path).toBe(false);
    }
    for (const path of ["a/file.md", "report #1?.md", "报告.md", "🙂.md", "literal%2Fname.md"]) {
      expect(safeStoragePath(path), path).toBe(true);
    }
  });

  it("derives parent and name from relative paths and sorts deterministic directories first", () => {
    const response = { paths: [
      { kind: "file" as const, path: "z.md", name: "wrong" },
      { kind: "file" as const, path: "docs/nested/note.md", name: "/host/secret" },
      { kind: "directory" as const, path: "empty", name: "wrong" },
      { kind: "file" as const, path: "a.md", name: "wrong" },
    ], truncated: false, storageRootPath: "/host/secret" };
    const projection = projectStorageListing(response);
    expect(projection.entries.filter((entry) => entry.parent === "").map((entry) => entry.name)).toEqual(["docs", "empty", "a.md", "z.md"]);
    expect(projection.entries.find((entry) => entry.path === "docs/nested/note.md")).toMatchObject({ parent: "docs/nested", name: "note.md", kind: "file" });
    expect(JSON.stringify(projection)).not.toContain("/host/secret");
    expect(projectStorageListing({ ...response, paths: [...response.paths].reverse() })).toEqual(projection);
  });

  it("bounds returned and inferred nodes, path bytes and nesting without reading file bodies", () => {
    const projection = projectStorageListing({ paths: Array.from({ length: 500 }, (_, index) => ({ path: `folder-${index}/nested/file.md`, kind: "file" })), truncated: false });
    expect(projection.entries).toHaveLength(STORAGE_ENTRY_LIMIT);
    expect(projection.truncated).toBe(true);
    expect(JSON.stringify(projection).length).toBeLessThan(100_000);
    expect(safeStoragePath(`${"a/".repeat(20)}file`)).toBe(false);
    expect(safeStoragePath("a".repeat(1025))).toBe(false);
  });

  it("does not infer an empty listing from withheld malformed entries", () => {
    expect(projectStorageListing({ paths: [{ kind: "file", path: "../escape" }], truncated: false })).toEqual({ entries: [], truncated: false, unavailable: true });
  });
});
