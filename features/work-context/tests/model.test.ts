import { describe, expect, it } from "vitest";
import { queryKeys, queryPolicies } from "../../../query-runtime";
import {
  projectWorkTaskBindingOwnership,
  shouldPollWorkActivity,
} from "../model";

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

  it("declares the documented provider-health policy exactly", () => {
    expect(queryPolicies.health).toEqual({
      staleTime: 15_000,
      gcTime: 2 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    });
  });

  it("projects root, direct, and delegated binding ownership from owner fields", () => {
    const bindings = [
      {
        rootThreadId: "thr_root",
        outcomeTaskId: "task_outcome",
        executionTaskId: null,
        ownerThreadId: null,
      },
      {
        rootThreadId: "thr_root",
        outcomeTaskId: "task_outcome",
        executionTaskId: "task_direct",
        ownerThreadId: "thr_root",
      },
      {
        rootThreadId: "thr_root",
        outcomeTaskId: "task_outcome",
        executionTaskId: "task_delegated",
        ownerThreadId: "thr_child",
      },
    ];
    expect(projectWorkTaskBindingOwnership("thr_root", bindings)).toEqual({
      bindingOwnedTaskIds: new Set([
        "task_outcome",
        "task_direct",
        "task_delegated",
      ]),
      currentThreadBindingTaskIds: new Set(["task_outcome", "task_direct"]),
    });
    expect(
      projectWorkTaskBindingOwnership("thr_child", bindings)
        .currentThreadBindingTaskIds,
    ).toEqual(new Set(["task_delegated"]));
  });
});
