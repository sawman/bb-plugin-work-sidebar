import { describe, expect, it, vi } from "vitest";
import { createThreadHierarchyService } from "../hierarchy-server";
import type { HierarchyThread } from "../hierarchy-model";

const roster: HierarchyThread[] = [
  {
    id: "thr_root",
    projectId: "project_one",
    parentThreadId: null,
    isArchived: false,
    title: "Root",
  },
  {
    id: "thr_child",
    projectId: "project_one",
    parentThreadId: "thr_root",
    isArchived: false,
    title: "Child",
  },
  {
    id: "thr_other",
    projectId: "project_one",
    parentThreadId: null,
    isArchived: false,
    title: "Other",
  },
];

function fixture(options: { saveRejects?: boolean; bound?: boolean } = {}) {
  const updateThread = vi.fn(async () => undefined);
  const saveGroups = vi.fn(async () => {
    if (options.saveRejects) throw new Error("preference write failed");
    return undefined;
  });
  const service = createThreadHierarchyService({
    getThread: async (threadId) => roster.find((thread) => thread.id === threadId)!,
    listThreads: async () => roster,
    updateThread,
    readBindings: async () => ({
      outcomes: [],
      executions: options.bound
        ? [
            {
              rootThreadId: "thr_root",
              ownerThreadId: "thr_child",
              executionTaskId: "task_execution",
            },
          ]
        : [],
    }),
    taskKey: async (taskId) =>
      taskId === "task_execution" ? "BBPLUG-2" : taskId,
    readGroups: async () => ({
      groups: [
        {
          id: "group_later",
          name: "Later",
          threadIds: ["thr_other", "thr_child"],
        },
      ],
      activeGroupPosition: 0,
    }),
    saveGroups,
  });
  return { service, updateThread, saveGroups };
}

describe("thread hierarchy server service", () => {
  it("reparents through the SDK and removes the nested subtree from custom groups", async () => {
    const { service, updateThread, saveGroups } = fixture();

    await expect(
      service.move({
        threadId: "thr_other",
        parentThreadId: "thr_child",
      }),
    ).resolves.toEqual({
      threadId: "thr_other",
      parentThreadId: "thr_child",
    });

    expect(updateThread).toHaveBeenCalledTimes(1);
    expect(updateThread).toHaveBeenCalledWith({
      threadId: "thr_other",
      parentThreadId: "thr_child",
    });
    expect(saveGroups).toHaveBeenCalledWith(
      [
        {
          id: "group_later",
          name: "Later",
          threadIds: ["thr_child"],
        },
      ],
      0,
    );
  });

  it("promotes an unbound child and keeps it out of stale custom groups", async () => {
    const { service, updateThread, saveGroups } = fixture();

    await service.move({ threadId: "thr_child", parentThreadId: null });

    expect(updateThread).toHaveBeenCalledWith({
      threadId: "thr_child",
      parentThreadId: null,
    });
    expect(saveGroups).toHaveBeenCalledWith(
      [
        {
          id: "group_later",
          name: "Later",
          threadIds: ["thr_other"],
        },
      ],
      0,
    );
  });

  it("rejects a root-changing durable execution binding before any write", async () => {
    const { service, updateThread, saveGroups } = fixture({ bound: true });

    await expect(
      service.move({
        threadId: "thr_child",
        parentThreadId: "thr_other",
      }),
    ).rejects.toThrow(/BBPLUG-2 owns durable work/);
    expect(updateThread).not.toHaveBeenCalled();
    expect(saveGroups).not.toHaveBeenCalled();
  });

  it("restores the original parent when group persistence fails", async () => {
    const { service, updateThread } = fixture({ saveRejects: true });

    await expect(
      service.move({
        threadId: "thr_other",
        parentThreadId: "thr_child",
      }),
    ).rejects.toThrow("preference write failed");
    expect(updateThread.mock.calls).toEqual([
      [{ threadId: "thr_other", parentThreadId: "thr_child" }],
      [{ threadId: "thr_other", parentThreadId: null }],
    ]);
  });
});
