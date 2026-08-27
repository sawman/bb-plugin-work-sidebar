import { describe, expect, it } from "vitest";
import { selectThreadIds } from "../model";

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
