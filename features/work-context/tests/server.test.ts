import { describe, expect, it, vi } from "vitest";
import { createWorkContextReadService } from "../server-reads";

describe("work-context server read service", () => {
  it("executes each requested card dependency without aggregate fan-out", async () => {
    const readStatus = vi.fn(async () => "status");
    const readOutcome = vi.fn(async () => "outcome");
    const readGoal = vi.fn(async () => "goal");
    const readPlan = vi.fn(async () => "plan");
    const reads = createWorkContextReadService({ readStatus, readOutcome, readGoal, readPlan });
    await expect(reads.status("thr_one")).resolves.toBe("status");
    await expect(reads.outcome("thr_two")).resolves.toBe("outcome");
    await expect(reads.goal("thr_three")).resolves.toBe("goal");
    await expect(reads.plan("thr_four")).resolves.toBe("plan");
    expect(readStatus).toHaveBeenCalledExactlyOnceWith("thr_one");
    expect(readOutcome).toHaveBeenCalledExactlyOnceWith("thr_two");
    expect(readGoal).toHaveBeenCalledExactlyOnceWith("thr_three");
    expect(readPlan).toHaveBeenCalledExactlyOnceWith("thr_four");
  });
});
