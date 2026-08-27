import { describe, expect, it, vi } from "vitest";
import type { ExecutionBinding } from "../../work-context/server-bindings.js";
import {
  finalizeWorkBindingOwner,
  publishWorkBindingReady,
} from "../server-work-bindings.js";

const pendingBinding: ExecutionBinding = {
  kind: "execution",
  rootThreadId: "thr_root",
  outcomeTaskId: "task_outcome",
  taskProjectId: "project_work",
  executionTaskId: "task_execution",
  ownerThreadId: null,
  mode: null,
  idempotencyKey: "owner-test",
  dispatchState: "pending_attachment",
  recoveryMessage: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("work binding realtime publication", () => {
  it("keeps the root Work then Tasks pair adjacent before a distinct owner Work envelope", () => {
    const published = vi.fn();
    const realtime = {
      publish: (channel: string, payload: unknown) =>
        published(channel, payload),
    };

    publishWorkBindingReady(realtime, "thr_root");

    expect(published.mock.calls).toEqual([
      ["work-sidebar:changed", { family: "work", threadId: "thr_root" }],
      ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
    ]);

    published.mockClear();
    publishWorkBindingReady(realtime, "thr_root", "thr_child");
    expect(published.mock.calls).toEqual([
      ["work-sidebar:changed", { family: "work", threadId: "thr_root" }],
      ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
      ["work-sidebar:changed", { family: "work", threadId: "thr_child" }],
    ]);
  });

  it.each([
    ["direct", "thr_root", null],
    ["delegated", "thr_child", "thr_child"],
  ] as const)(
    "finalizes a %s owner by saving ready state and publishing both families",
    async (mode, ownerThreadId, spawnedThreadId) => {
      const saved = vi.fn(async (binding: ExecutionBinding) => binding);
      const published = vi.fn();
      const realtime = {
        publish: (channel: string, payload: unknown) =>
          published(channel, payload),
      };

      const result = await finalizeWorkBindingOwner({
        pending: pendingBinding,
        mode,
        ownerThreadId,
        rootThreadId: "thr_root",
        spawnedThreadId,
        realtime,
        save: saved,
      });

      expect(saved).toHaveBeenCalledTimes(1);
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchState: "ready",
          mode,
          ownerThreadId,
          recoveryMessage: null,
        }),
      );
      expect(result).toMatchObject({
        binding: {
          dispatchState: "ready",
          mode,
          ownerThreadId,
          recoveryMessage: null,
        },
        spawnedThreadId,
      });
      expect(published.mock.calls).toEqual(
        ownerThreadId === "thr_root"
          ? [
              ["work-sidebar:changed", { family: "work", threadId: "thr_root" }],
              ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
            ]
          : [
              ["work-sidebar:changed", { family: "work", threadId: "thr_root" }],
              ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
              ["work-sidebar:changed", { family: "work", threadId: "thr_child" }],
            ],
      );
    },
  );
});
