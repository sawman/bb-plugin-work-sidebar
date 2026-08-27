import { describe, expect, it, vi } from "vitest";
import {
  createArchivedThreadService,
  createThreadPreferencesService,
  THREAD_PREFERENCE_KEYS,
} from "../server";

describe("R9 Threads server preferences", () => {
  it("normalizes recovered groups, persists sibling order and group preferences, and exposes no archive subprocess", async () => {
    const saved = new Map<string, unknown>([
      [
        THREAD_PREFERENCE_KEYS.groups,
        {
          groups: [
            {
              id: "group_later",
              name: "Later",
              threadIds: ["thr_b", "thr_b", "not-a-thread"],
            },
          ],
        },
      ],
      [THREAD_PREFERENCE_KEYS.order, ["thr_b", "thr_a", "thr_b", "bad"]],
    ]);
    const published: unknown[] = [];
    const service = createThreadPreferencesService({
      get: async (key) => saved.get(key),
      set: async (key, value) => {
        saved.set(key, value);
      },
      publish: (channel, payload) => published.push({ channel, payload }),
    });

    await expect(service.groups()).resolves.toEqual([
      { id: "group_later", name: "Later", threadIds: ["thr_b"] },
    ]);
    await expect(
      service.saveOrder(["thr_b", "thr_a", "thr_b", "bad"]),
    ).resolves.toEqual(["thr_b", "thr_a"]);
    await expect(
      service.saveGroups([
        { id: "group_later", name: "Later", threadIds: ["thr_a"] },
      ]),
    ).resolves.toEqual([
      { id: "group_later", name: "Later", threadIds: ["thr_a"] },
    ]);
    expect(published).toHaveLength(2);
    expect(service).not.toHaveProperty("archivedThreads");
  });
});

describe("R9 archived thread service", () => {
  it("passes the exact SDK list options and projects only live archived threads", async () => {
    const list = vi.fn(async () => [
      {
        id: "thr_archived",
        projectId: "project",
        title: "Archived",
        titleFallback: null,
        parentThreadId: "thr_parent",
        environmentBranchName: "feature/archive",
        pinnedAt: 10,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: 3,
        deletedAt: null,
      },
      {
        id: "thr_active",
        projectId: "project",
        title: "Active",
        titleFallback: null,
        parentThreadId: null,
        environmentBranchName: null,
        pinnedAt: null,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: null,
        deletedAt: null,
      },
      {
        id: "thr_deleted",
        projectId: "project",
        title: "Deleted",
        titleFallback: null,
        parentThreadId: null,
        environmentBranchName: null,
        pinnedAt: null,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: 3,
        deletedAt: 4,
      },
    ]);
    const unarchive = vi.fn(async () => ({ threadId: "thr_archived" }));
    const service = createArchivedThreadService({ list, unarchive });

    await expect(service.list()).resolves.toEqual([
      {
        id: "thr_archived",
        projectId: "project",
        title: "Archived",
        titleFallback: null,
        parentThreadId: "thr_parent",
        environmentBranchName: "feature/archive",
        isPinned: true,
        isUnread: false,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: 3,
      },
    ]);
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({
      archived: true,
      includeHidden: true,
      limit: 2_000,
    });
    await expect(service.unarchive("thr_archived")).resolves.toEqual({
      threadId: "thr_archived",
    });
    expect(unarchive).toHaveBeenCalledWith({ threadId: "thr_archived" });
  });
});
