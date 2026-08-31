import { describe, expect, it } from "vitest";
import { binThread, normalizeRecycleBin, restoreThread } from "../recycle-bin";

describe("plugin-managed Recycle Bin", () => {
  it("preserves the origin group and falls back to Active only when it vanished", () => {
    const entries = binThread([], "thr_saved", "group_later", 100);
    expect(entries).toEqual([{ threadId: "thr_saved", originGroupId: "group_later", binnedAt: 100 }]);
    expect(restoreThread(entries, "thr_saved", new Set(["group_later"]))).toEqual({ destination: "group_later", entries: [] });
    expect(restoreThread(entries, "thr_saved", new Set())).toEqual({ destination: null, entries: [] });
  });

  it("drops malformed and duplicate persisted entries", () => {
    expect(normalizeRecycleBin([
      { threadId: "thr_ok", originGroupId: null, binnedAt: 1 },
      { threadId: "thr_ok", originGroupId: "group_later", binnedAt: 2 },
      { threadId: "bad", originGroupId: null, binnedAt: 3 },
    ])).toEqual([{ threadId: "thr_ok", originGroupId: null, binnedAt: 1 }]);
  });
});
