import { describe, expect, it } from "vitest";
import { parseWorkSidebarRealtimeEvent } from "../../../shared/work-realtime";

describe("Work realtime payload boundary", () => {
  it("accepts only scoped known families", () => {
    expect(
      parseWorkSidebarRealtimeEvent({ family: "changes", threadId: "thr_one" }),
    ).toEqual({ family: "changes", threadId: "thr_one" });
    for (const payload of [
      undefined,
      {},
      { changed: "work" },
      { family: "work" },
      { family: "unknown", threadId: "thr_one" },
      { family: "work", threadId: "other" },
    ])
      expect(parseWorkSidebarRealtimeEvent(payload)).toBeNull();
  });
});
