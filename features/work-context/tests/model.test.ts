import { describe, expect, it } from "vitest";
import { queryKeys, queryPolicies } from "../../../query-runtime";
import { shouldPollWorkActivity } from "../model";

describe("work-context card model", () => {
  it("gives Status, Outcome, Goal, and Plan independently cacheable keys", () => {
    expect(Object.keys(queryKeys.work)).toEqual([
      "status",
      "activity",
      "outcome",
      "goal",
      "plan",
      "providerHealth",
    ]);
    expect(queryKeys.work.outcome("thr_one")).toEqual([
      "work-sidebar",
      "work",
      "outcome",
      "thr_one",
    ]);
    expect(queryPolicies.workContext).toMatchObject({
      staleTime: 5_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    });
  });

  it("declares the short-lived active-thread activity policy centrally", () => {
    expect(queryPolicies.workActivity).toMatchObject({
      staleTime: 0,
      gcTime: 2 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    });
    expect(shouldPollWorkActivity("active")).toBe(true);
    expect(shouldPollWorkActivity("starting")).toBe(true);
    expect(shouldPollWorkActivity("idle")).toBe(false);
  });
});
