import { describe, expect, it } from "vitest";
import {
  archiveDurationLabel,
  moveThreadGroup,
  reorderThreadGroup,
  selectThreadIds,
  threadGroupPositions,
  threadCountPresentation,
} from "../model";
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

describe("thread count presentation", () => {
  it("separates top-level threads from subthreads across the active roster", () => {
    expect(
      threadCountPresentation([
        { id: "thr_root", parentThreadId: null },
        { id: "thr_child", parentThreadId: "thr_root" },
        { id: "thr_nested", parentThreadId: "thr_child" },
        { id: "thr_orphan", parentThreadId: "thr_missing" },
      ]),
    ).toEqual({
      threads: 2,
      subthreads: 2,
      label: "2 threads · 2 subthreads",
    });
  });
});

describe("thread group ordering", () => {
  const groups = [
    { id: "group_alpha", name: "Alpha", threadIds: ["thr_a"] },
    { id: "group_beta", name: "Beta", threadIds: ["thr_b"] },
    { id: "group_gamma", name: "Gamma", threadIds: [] },
  ];

  it("moves one group without changing its contents", () => {
    expect(moveThreadGroup(groups, 0, "group_gamma", -1)).toEqual({
      groups: [groups[0], groups[2], groups[1]],
      activeGroupPosition: 0,
    });
    expect(moveThreadGroup(groups, 0, "group_alpha", -1)).toEqual({
      groups,
      activeGroupPosition: 1,
    });
  });

  it("returns the existing order at either boundary or for an unknown group", () => {
    expect(moveThreadGroup(groups, 0, "active", -1)).toBeNull();
    expect(moveThreadGroup(groups, 0, "group_gamma", 1)).toBeNull();
    expect(moveThreadGroup(groups, 0, "group_missing", 1)).toBeNull();
  });

  it("places Active among custom groups without creating a persisted custom row", () => {
    expect(
      threadGroupPositions(groups, 2).map(({ id }) => id),
    ).toEqual(["group_alpha", "group_beta", "active", "group_gamma"]);
  });

  it("reorders a dragged group directly onto another group", () => {
    expect(reorderThreadGroup(groups, 0, "active", "group_beta")).toEqual({
      groups: [groups[0], groups[1], groups[2]],
      activeGroupPosition: 2,
    });
    expect(
      reorderThreadGroup(groups, 2, "group_gamma", "group_alpha"),
    ).toEqual({
      groups: [groups[2], groups[0], groups[1]],
      activeGroupPosition: 3,
    });
    expect(
      reorderThreadGroup(groups, 0, "group_missing", "group_beta"),
    ).toBeNull();
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
