import { describe, expect, it } from "vitest";
import { parseWorkSidebarRealtimeEvent } from "../../../shared/work-realtime";

describe("Work realtime payload boundary", () => {
  it("uses a root scope for Work and a thread scope for every other family", () => {
    expect(
      parseWorkSidebarRealtimeEvent({ family: "changes", threadId: "thr_one" }),
    ).toEqual({ family: "changes", threadId: "thr_one" });
    expect(
      parseWorkSidebarRealtimeEvent({ family: "work", rootThreadId: "thr_root" }),
    ).toEqual({ family: "work", rootThreadId: "thr_root" });
    for (const payload of [
      undefined,
      {},
      { changed: "work" },
      { family: "work" },
      { family: "unknown", threadId: "thr_one" },
      { family: "work", threadId: "thr_one" },
      { family: "changes", rootThreadId: "thr_one" },
      { family: "work", threadId: "other" },
    ])
      expect(parseWorkSidebarRealtimeEvent(payload)).toBeNull();
  });
});
