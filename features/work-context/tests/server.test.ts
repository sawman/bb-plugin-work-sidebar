import { describe, expect, it, vi } from "vitest";
import { createWorkContextReadService } from "../server-reads";

describe("work-context server read service", () => {
  it("executes only the requested card dependency without aggregate fan-out", async () => {
    const readStatus = vi.fn(async () => "status");
    const readOutcome = vi.fn(async () => "outcome");
    const readGoal = vi.fn(async () => "goal");
    const readPlan = vi.fn(async () => "plan");
    const reads = createWorkContextReadService({ readStatus, readOutcome, readGoal, readPlan });
    await expect(reads.status("thr_one")).resolves.toBe("status");
    expect(readStatus).toHaveBeenCalledWith("thr_one");
    expect(readOutcome).not.toHaveBeenCalled();
    expect(readGoal).not.toHaveBeenCalled();
    expect(readPlan).not.toHaveBeenCalled();
  });
});
