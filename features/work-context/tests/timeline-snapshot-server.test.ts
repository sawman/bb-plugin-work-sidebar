import { describe, expect, it, vi } from "vitest";
import {
  MAX_WORK_TIMELINE_SNAPSHOTS,
  createWorkTimelineSnapshotService,
} from "../timeline-snapshot-server";

type Snapshot = { version: number };

describe("work timeline snapshot service", () => {
  it("deduplicates concurrent reads and reuses the exact snapshot inside its TTL", async () => {
    let resolve!: (value: Snapshot) => void;
    const timeline = vi.fn(
      () =>
        new Promise<Snapshot>((done) => {
          resolve = done;
        }),
    );
    let now = 1_000;
    const service = createWorkTimelineSnapshotService({
      timeline,
      now: () => now,
      ttlMs: 1_000,
    });

    const first = service.read("thr_one");
    const second = service.read("thr_one");
    expect(timeline).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_one" });
    resolve({ version: 1 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { version: 1 },
      { version: 1 },
    ]);

    now += 999;
    await expect(service.read("thr_one")).resolves.toEqual({ version: 1 });
    expect(timeline).toHaveBeenCalledTimes(1);

    now += 1;
    timeline.mockResolvedValueOnce({ version: 2 });
    await expect(service.read("thr_one")).resolves.toEqual({ version: 2 });
    expect(timeline).toHaveBeenCalledTimes(2);
  });

  it("keeps exact thread scope, invalidates stale work, and bounds snapshots by LRU", async () => {
    let now = 1_000;
    const timeline = vi.fn(async ({ threadId }: { threadId: string }) => ({
      version: Number(threadId.slice(4)) + now,
    }));
    const service = createWorkTimelineSnapshotService({
      timeline,
      now: () => now,
      ttlMs: 10_000,
    });

    for (let index = 0; index < MAX_WORK_TIMELINE_SNAPSHOTS; index += 1)
      await service.read(`thr_${index}`);
    await service.read("thr_0");
    await service.read(`thr_${MAX_WORK_TIMELINE_SNAPSHOTS}`);

    expect(service.inspect()).toEqual({
      disposed: false,
      cached: MAX_WORK_TIMELINE_SNAPSHOTS,
      pending: 0,
      generations: 0,
    });
    expect(service.has("thr_0")).toBe(true);
    expect(service.has("thr_1")).toBe(false);
    expect(service.has(`thr_${MAX_WORK_TIMELINE_SNAPSHOTS}`)).toBe(true);

    now += 1;
    service.invalidate("thr_0");
    await service.read("thr_0");
    expect(timeline).toHaveBeenLastCalledWith({ threadId: "thr_0" });
    expect(timeline.mock.calls.filter(([input]) => input.threadId === "thr_0")).toHaveLength(2);
  });

  it("does not let invalidated or disposed in-flight work repopulate the lifecycle", async () => {
    const resolutions: Array<(value: Snapshot) => void> = [];
    const timeline = vi.fn(
      () =>
        new Promise<Snapshot>((resolve) => {
          resolutions.push(resolve);
        }),
    );
    const service = createWorkTimelineSnapshotService({ timeline });

    const stale = service.read("thr_one");
    service.invalidate("thr_one");
    const fresh = service.read("thr_one");
    expect(timeline).toHaveBeenCalledTimes(2);
    resolutions[0]!({ version: 1 });
    await expect(stale).resolves.toEqual({ version: 1 });
    expect(service.inspect().cached).toBe(0);
    resolutions[1]!({ version: 2 });
    await expect(fresh).resolves.toEqual({ version: 2 });
    expect(service.inspect().cached).toBe(1);
    expect(service.inspect().generations).toBe(0);

    const retiring = service.read("thr_two");
    service.dispose();
    expect(service.inspect()).toEqual({
      disposed: true,
      cached: 0,
      pending: 0,
      generations: 0,
    });
    resolutions[2]!({ version: 3 });
    await expect(retiring).rejects.toThrow("Work timeline snapshot service is disposed.");
    await expect(service.read("thr_two")).rejects.toThrow(
      "Work timeline snapshot service is disposed.",
    );
    expect(service.inspect()).toEqual({
      disposed: true,
      cached: 0,
      pending: 0,
      generations: 0,
    });
  });

  it("does not cache a rejected read or couple a later card retry to it", async () => {
    const timeline = vi
      .fn<({ threadId }: { threadId: string }) => Promise<Snapshot>>()
      .mockRejectedValueOnce(new Error("timeline unavailable"))
      .mockResolvedValueOnce({ version: 2 });
    const service = createWorkTimelineSnapshotService({ timeline });

    await expect(service.read("thr_retry")).rejects.toThrow(
      "timeline unavailable",
    );
    await expect(service.read("thr_retry")).resolves.toEqual({ version: 2 });
    expect(timeline).toHaveBeenCalledTimes(2);
    expect(service.inspect()).toEqual({
      disposed: false,
      cached: 1,
      pending: 0,
      generations: 0,
    });
  });
});
