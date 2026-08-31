import { describe, expect, it, vi } from "vitest";
import {
  binThread,
  expiredRecycleBinEntries,
  normalizeRecycleBin,
  restoreThread,
} from "../recycle-bin";
import { createRecycleBinExpiryHandler } from "../recycle-bin-expiry";

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

  it("selects only records at or beyond an automation's explicit retention", () => {
    const day = 24 * 60 * 60 * 1_000;
    const entries = [
      { threadId: "thr_old", originGroupId: null, binnedAt: 1 },
      { threadId: "thr_recent", originGroupId: null, binnedAt: day + 1 },
    ];
    expect(expiredRecycleBinEntries(entries, 7, 8 * day)).toEqual([
      entries[0],
    ]);
  });

  it("persists each accepted archive before stopping on a later host failure", async () => {
    let entries = [
      { threadId: "thr_first", originGroupId: null, binnedAt: 1 },
      { threadId: "thr_second", originGroupId: null, binnedAt: 1 },
    ];
    const archive = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("host unavailable"));
    const expire = createRecycleBinExpiryHandler(
      {
        recycleBin: async () => entries,
        removeBinnedThread: async (threadId) => {
          entries = entries.filter((entry) => entry.threadId !== threadId);
          return entries;
        },
      },
      archive,
    );
    await expect(expire({ retentionDays: 1 })).rejects.toThrow("host unavailable");
    expect(archive).toHaveBeenCalledWith("thr_first");
    expect(entries).toEqual([
      { threadId: "thr_second", originGroupId: null, binnedAt: 1 },
    ]);
  });
});
