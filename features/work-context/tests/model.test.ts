import { describe, expect, it } from "vitest";
import { workContextCardKeys, workContextCardPolicy } from "../model";

describe("work-context card model", () => {
  it("gives Status, Tasks, Outcome, Goal, and Plan independently cacheable keys", () => {
    expect(Object.keys(workContextCardKeys)).toEqual(["status", "tasks", "outcome", "goal", "plan"]);
    expect(workContextCardKeys.outcome("thr_one")).toEqual(["work-sidebar", "work-context", "outcome", "thr_one"]);
    expect(workContextCardPolicy).toMatchObject({ staleTime: 5_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false });
  });
});
