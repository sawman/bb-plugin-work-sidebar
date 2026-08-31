import { describe, expect, it, vi } from "vitest";
import {
  createSdkThreadHierarchyService,
  createThreadHierarchyService,
} from "../hierarchy-server";
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
  const publishWork = vi.fn();
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
    allTasksById: async () =>
      new Map([["task_execution", { key: "BBPLUG-2" }]]),
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
    publishWork,
  });
  return { service, updateThread, saveGroups, publishWork };
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
      oldRootThreadId: "thr_other",
      newRootThreadId: "thr_root",
      affectedThreadIds: ["thr_other"],
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
    const { service, updateThread, publishWork } = fixture({ saveRejects: true });

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
    expect(publishWork).not.toHaveBeenCalled();
  });

  it("uses the exact SDK hierarchy reads and fails closed when an ancestor is absent", async () => {
    const get = vi.fn(async ({ threadId }: { threadId: string }) =>
      ({
        ...roster.find((thread) => thread.id === threadId)!,
        archivedAt: null,
        titleFallback: null,
      }),
    );
    const list = vi.fn(async () => roster);
    const update = vi.fn(async () => undefined);
    const publish = vi.fn();
    const groups = vi.fn(async () => ({ groups: [], activeGroupPosition: 0 }));
    const saveGroups = vi.fn(async () => ({
      groups: [],
      activeGroupPosition: 0,
    }));
    const service = createSdkThreadHierarchyService(
      {
        sdk: { threads: { get, list, update } },
        realtime: { publish },
      } as never,
      {
        bindings: async () => ({ outcomes: [], executions: [] }),
        allTasksById: async () => new Map(),
      },
      { groups, saveGroups },
    );

    await service.move({ threadId: "thr_other", parentThreadId: "thr_child" });

    expect(get.mock.calls).toEqual([
      [{ threadId: "thr_other" }],
      [{ threadId: "thr_child" }],
    ]);
    expect(list).toHaveBeenCalledWith({
      projectId: "project_one",
      archived: false,
      includeHidden: true,
      limit: 2_000,
    });
    expect(update).toHaveBeenCalledWith({
      threadId: "thr_other",
      parentThreadId: "thr_child",
    });
    expect(publish.mock.calls).toEqual([
      [
        "work-sidebar:changed",
        { family: "work", rootThreadId: "thr_other" },
      ],
      [
        "work-sidebar:changed",
        { family: "work", rootThreadId: "thr_root" },
      ],
    ]);

    get.mockImplementation(async ({ threadId }: { threadId: string }) => ({
      ...roster.find((thread) => thread.id === threadId)!,
      archivedAt: null,
      titleFallback: null,
      parentThreadId: "thr_missing",
    }));
    list.mockResolvedValue([roster[1]!, roster[2]!]);
    await expect(
      service.move({ threadId: "thr_child", parentThreadId: null }),
    ).rejects.toThrow(/hierarchy is not fully loaded/i);

    list.mockResolvedValue(
      Array.from({ length: 2_000 }, (_, index) => ({
        ...roster[0]!,
        id: `thr_${index}`,
      })),
    );
    await expect(
      service.move({ threadId: "thr_other", parentThreadId: null }),
    ).rejects.toThrow(/hierarchy is not fully loaded/i);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("reads the task list once when projecting multiple durable bindings", async () => {
    const get = vi.fn(async ({ threadId }: { threadId: string }) => ({
      ...roster.find((thread) => thread.id === threadId)!,
      archivedAt: null,
      titleFallback: null,
    }));
    const list = vi.fn(async () => roster);
    const update = vi.fn(async () => undefined);
    const publish = vi.fn();
    const groups = vi.fn(async () => ({ groups: [], activeGroupPosition: 0 }));
    const saveGroups = vi.fn(async () => ({
      groups: [],
      activeGroupPosition: 0,
    }));
    const allTasksById = vi.fn(async () =>
      new Map([
        ["task_outcome", { key: "BBPLUG-1" }],
        ["task_execution_one", { key: "BBPLUG-2" }],
        ["task_execution_two", { key: "BBPLUG-3" }],
      ]),
    );
    const service = createSdkThreadHierarchyService(
      {
        sdk: { threads: { get, list, update } },
        realtime: { publish },
      } as never,
      {
        bindings: async () => ({
          outcomes: [
            { rootThreadId: "thr_root", outcomeTaskId: "task_outcome" },
          ],
          executions: [
            {
              rootThreadId: "thr_root",
              ownerThreadId: "thr_child",
              executionTaskId: "task_execution_one",
            },
            {
              rootThreadId: "thr_root",
              ownerThreadId: "thr_root",
              executionTaskId: "task_execution_two",
            },
          ],
        }),
        allTasksById,
      },
      { groups, saveGroups },
    );

    await service.move({ threadId: "thr_other", parentThreadId: "thr_child" });

    expect(allTasksById).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
