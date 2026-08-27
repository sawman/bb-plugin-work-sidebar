import { describe, expect, it } from "vitest";
import { createThreadPreferencesService, THREAD_PREFERENCE_KEYS } from "../server";

describe("R9 Threads server preferences", () => {
  it("normalizes recovered groups, persists sibling order and group preferences, and exposes no archive subprocess", async () => {
    const saved = new Map<string, unknown>([
      [THREAD_PREFERENCE_KEYS.groups, { groups: [{ id: "group_later", name: "Later", threadIds: ["thr_b", "thr_b", "not-a-thread"] }] }],
      [THREAD_PREFERENCE_KEYS.order, ["thr_b", "thr_a", "thr_b", "bad"]],
    ]);
    const published: unknown[] = [];
    const service = createThreadPreferencesService({
      get: async (key) => saved.get(key),
      set: async (key, value) => { saved.set(key, value); },
      publish: (channel, payload) => published.push({ channel, payload }),
    });

    await expect(service.groups()).resolves.toEqual([{ id: "group_later", name: "Later", threadIds: ["thr_b"] }]);
    await expect(service.saveOrder(["thr_b", "thr_a", "thr_b", "bad"])).resolves.toEqual(["thr_b", "thr_a"]);
    await expect(service.saveGroups([{ id: "group_later", name: "Later", threadIds: ["thr_a"] }])).resolves.toEqual([{ id: "group_later", name: "Later", threadIds: ["thr_a"] }]);
    expect(published).toHaveLength(2);
    expect(service).not.toHaveProperty("archivedThreads");
  });
});
