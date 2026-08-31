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
      [THREAD_PREFERENCE_KEYS.appearance, 47.5],
      [THREAD_PREFERENCE_KEYS.textScale, 0.9],
    ]);
    const published: unknown[] = [];
    const service = createThreadPreferencesService({
      get: async (key) => saved.get(key),
      set: async (key, value) => {
        saved.set(key, value);
      },
      publish: (channel, payload) => published.push({ channel, payload }),
    });

    await expect(service.groups()).resolves.toEqual({
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_b"] },
      ],
      activeGroupPosition: 0,
    });
    await expect(
      service.saveOrder(["thr_b", "thr_a", "thr_b", "bad"]),
    ).resolves.toEqual(["thr_b", "thr_a"]);
    await expect(
      service.saveGroups(
        [{ id: "group_later", name: "Later", threadIds: ["thr_a"] }],
        1,
      ),
    ).resolves.toEqual({
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_a"] },
      ],
      activeGroupPosition: 1,
    });
    await expect(service.appearance()).resolves.toEqual({
      rowHeight: 47.5,
      textScale: 0.9,
      workingProviderAnimation: "slow-spin",
    });
    await expect(service.saveAppearance(52.5)).resolves.toEqual({
      rowHeight: 52.5,
      textScale: 0.9,
      workingProviderAnimation: "slow-spin",
    });
    expect(saved.get(THREAD_PREFERENCE_KEYS.appearance)).toBe(52.5);
    await expect(service.saveTextScale(1.1)).resolves.toEqual({
      rowHeight: 52.5,
      textScale: 1.1,
      workingProviderAnimation: "slow-spin",
    });
    expect(saved.get(THREAD_PREFERENCE_KEYS.textScale)).toBe(1.1);
    await expect(service.saveWorkingProviderAnimation("fast-spin")).resolves.toEqual({
      rowHeight: 52.5,
      textScale: 1.1,
      workingProviderAnimation: "fast-spin",
    });
    expect(saved.get(THREAD_PREFERENCE_KEYS.workingProviderAnimation)).toBe(
      "fast-spin",
    );
    await expect(service.saveWorkingProviderAnimation("invalid")).rejects.toThrow(
      "Choose a supported working-provider animation.",
    );
    await expect(service.saveTextScale(1.11)).rejects.toThrow(
      "Enter a value from 0.9 to 1.1.",
    );
    await expect(service.saveAppearance(60.25)).rejects.toThrow(
      "Enter a number with at most one decimal place.",
    );
    expect(saved.get(THREAD_PREFERENCE_KEYS.appearance)).toBe(52.5);
    expect(saved.get(THREAD_PREFERENCE_KEYS.groups)).toEqual({
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_a"] },
      ],
      activeGroupPosition: 1,
    });
    await expect(service.binThread("thr_a", "group_later")).resolves.toEqual([
      { threadId: "thr_a", originGroupId: "group_later", binnedAt: expect.any(Number) },
    ]);
    await expect(
      service.restoreBinnedThread("thr_a", ["group_later"]),
    ).resolves.toEqual({ destination: "group_later", entries: [] });
    expect(published[1]).toEqual({
      channel: "sidebar-order:changed",
      payload: {
        groups: [
          { id: "group_later", name: "Later", threadIds: ["thr_a"] },
        ],
        activeGroupPosition: 1,
      },
    });
    expect(published[2]).toEqual({
      channel: "sidebar-order:changed",
      payload: { appearance: { rowHeight: 52.5 } },
    });
    expect(published[3]).toEqual({
      channel: "sidebar-order:changed",
      payload: { appearance: { textScale: 1.1 } },
    });
    expect(published[4]).toEqual({
      channel: "sidebar-order:changed",
      payload: { appearance: { workingProviderAnimation: "fast-spin" } },
    });
    expect(published).toHaveLength(7);
    expect(published.slice(-2)).toEqual([
      expect.objectContaining({ channel: "sidebar-order:changed", payload: expect.objectContaining({ recycleBin: expect.any(Array) }) }),
      expect.objectContaining({ channel: "sidebar-order:changed", payload: expect.objectContaining({ recycleBin: [] }) }),
    ]);
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
        providerId: "codex",
        environmentBranchName: "feature/archive",
        environmentName: "Archive worktree",
        environmentWorkspaceDisplayKind: "managed-worktree" as const,
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
        providerId: "codex",
        environmentBranchName: null,
        environmentName: null,
        environmentWorkspaceDisplayKind: "other" as const,
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
        providerId: "codex",
        environmentBranchName: null,
        environmentName: null,
        environmentWorkspaceDisplayKind: "other" as const,
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
        providerId: "codex",
        environmentBranchName: "feature/archive",
        environmentName: "Archive worktree",
        environmentWorkspaceDisplayKind: "managed-worktree",
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
