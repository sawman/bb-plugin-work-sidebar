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
  it("publishes exactly the root-scoped Work then Tasks pair", () => {
    const published = vi.fn();
    const realtime = {
      publish: (channel: string, payload: unknown) =>
        published(channel, payload),
    };

    publishWorkBindingReady(realtime, "thr_root");

    expect(published.mock.calls).toEqual([
      ["work-sidebar:changed", { family: "work", rootThreadId: "thr_root" }],
      ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
    ]);

    published.mockClear();
    publishWorkBindingReady(realtime, "thr_root");
    expect(published.mock.calls).toEqual([
      ["work-sidebar:changed", { family: "work", rootThreadId: "thr_root" }],
      ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
    ]);
  });

  it.each([
    ["direct", "thr_root", null],
    ["delegated", "thr_child", "thr_child"],
  ] as const)(
    "finalizes a %s owner by saving ready state and publishing the root pair",
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
      expect(published.mock.calls).toEqual([
        ["work-sidebar:changed", { family: "work", rootThreadId: "thr_root" }],
        ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
      ]);
    },
  );
});
