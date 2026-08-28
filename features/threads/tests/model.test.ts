import { describe, expect, it } from "vitest";
import { archiveDurationLabel, selectThreadIds } from "../model";
import { visibleThreadTreeIds } from "../thread-tree-model";

describe("thread interaction selection", () => {
  const visibleIds = ["thr_a", "thr_b", "thr_c", "thr_d"];

  it("uses Ctrl or Command to toggle while retaining the selection anchor", () => {
    expect(selectThreadIds(new Set(["thr_a"]), "thr_a", visibleIds, "thr_c", { toggle: true }))
      .toEqual({ selectedIds: new Set(["thr_a", "thr_c"]), anchorId: "thr_c", handled: true });
    expect(selectThreadIds(new Set(["thr_a", "thr_c"]), "thr_c", visibleIds, "thr_c", { toggle: true }))
      .toEqual({ selectedIds: new Set(["thr_a"]), anchorId: "thr_c", handled: true });
  });

  it("extends a deterministic inclusive range from its Shift anchor", () => {
    expect(selectThreadIds(new Set(["thr_a"]), "thr_a", visibleIds, "thr_c", { range: true }))
      .toEqual({ selectedIds: new Set(["thr_a", "thr_b", "thr_c"]), anchorId: "thr_a", handled: true });
  });

  it("falls back to a single selected target when its anchor left the roster", () => {
    expect(selectThreadIds(new Set(["thr_a"]), "thr_x", visibleIds, "thr_c", { range: true }))
      .toEqual({ selectedIds: new Set(["thr_c"]), anchorId: "thr_c", handled: true });
  });
});

describe("thread tree traversal", () => {
  it("keeps visible parent and child ids in tree order inside the Threads slice", () => {
    const parent = { id: "thr_parent" } as never;
    const child = { id: "thr_child" } as never;
    const sibling = { id: "thr_sibling" } as never;

    expect(
      visibleThreadTreeIds([parent, sibling], new Map([["thr_parent", [child]]])),
    ).toEqual(["thr_parent", "thr_child", "thr_sibling"]);
  });
});

describe("archived thread duration", () => {
  it("formats a compact duration from the host archival timestamp", () => {
    const archivedAt = Date.UTC(2026, 7, 28, 0, 0, 0);

    expect(archiveDurationLabel(archivedAt, archivedAt + 42_000)).toBe("<1m");
    expect(archiveDurationLabel(archivedAt, archivedAt + 12 * 60_000)).toBe("12m");
    expect(archiveDurationLabel(archivedAt, archivedAt + 3 * 3_600_000)).toBe("3h");
    expect(archiveDurationLabel(archivedAt, archivedAt + 8 * 86_400_000)).toBe("8d");
    expect(archiveDurationLabel(0, archivedAt)).toBeNull();
    expect(archiveDurationLabel(archivedAt, archivedAt - 1)).toBeNull();
  });
});
