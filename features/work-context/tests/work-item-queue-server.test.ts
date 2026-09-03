import { describe, expect, it, vi } from "vitest";
import {
  createWorkItemQueueService,
  normalizeWorkItemQueue,
} from "../work-item-queue-server";

describe("durable work-item queue", () => {
  it("caps recovered backlog history", () => {
    const queue = normalizeWorkItemQueue({
      current: null,
      backlog: Array.from({ length: 101 }, (_, index) => ({
        source: "bb_task",
        id: `task-${index}`,
      })),
    });
    expect(queue.backlog).toHaveLength(100);
    expect(queue.backlog.at(-1)).toEqual({ source: "bb_task", id: "task-99" });
  });

  it("distinguishes an absent queue from a deliberately empty queue", async () => {
    const stored = new Map<string, unknown>();
    const service = createWorkItemQueueService({
      get: async (rootThreadId) => stored.get(rootThreadId),
      set: async (rootThreadId, next) => { stored.set(rootThreadId, next); },
      publish: vi.fn(),
      ensureOutcome: vi.fn(),
      createExecution: vi.fn(),
    });

    await expect(service.read("thr_root")).resolves.toEqual({
      configured: false,
      queue: { current: null, backlog: [] },
    });
    await expect(service.write("thr_root", { current: null, backlog: [] })).resolves.toEqual({
      configured: true,
      queue: { current: null, backlog: [] },
    });
    await expect(service.read("thr_root")).resolves.toEqual({
      configured: true,
      queue: { current: null, backlog: [] },
    });
  });

  it("creates one execution record, preserves provenance, and promotes the next goal", async () => {
    const stored = new Map<string, unknown>([
      ["thr_root", {
        current: { source: "linear", id: "LIN-1" },
        backlog: [{ source: "bb_task", id: "task-2" }],
      }],
    ]);
    const createExecution = vi.fn(async () => ({ task: { id: "task-execution" } }));
    const publish = vi.fn();
    const service = createWorkItemQueueService({
      get: async (rootThreadId) => stored.get(rootThreadId),
      set: async (rootThreadId, next) => { stored.set(rootThreadId, next); },
      publish,
      ensureOutcome: vi.fn(),
      createExecution,
    });

    await expect(service.moveToExecution(
      "thr_root",
      { source: "linear", id: "LIN-1" },
      "Ship it",
      "External goal",
    )).resolves.toEqual({
      taskId: "task-execution",
      configured: true,
      queue: {
        current: { source: "bb_task", id: "task-2" },
        backlog: [],
      },
    });
    expect(createExecution).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "work-item-execution:linear:LIN-1",
      description: "External goal\n\nWork-item source: linear:LIN-1",
    }));
    expect(publish).toHaveBeenCalledExactlyOnceWith("thr_root");
    expect(normalizeWorkItemQueue(stored.get("thr_root"))).toEqual({
      current: { source: "bb_task", id: "task-2" },
      backlog: [],
    });
  });

  it("requires a backlog replacement before moving the sole current goal to tasks", async () => {
    const createExecution = vi.fn(async () => ({ task: { id: "task-execution" } }));
    const publish = vi.fn();
    const service = createWorkItemQueueService({
      get: async (rootThreadId) => rootThreadId === "thr_root"
        ? { current: { source: "linear", id: "LIN-1" }, backlog: [] }
        : undefined,
      set: vi.fn(),
      publish,
      ensureOutcome: vi.fn(),
      createExecution,
    });

    await expect(service.moveToExecution(
      "thr_root",
      { source: "linear", id: "LIN-1" },
      "Ship it",
      "External goal",
    )).rejects.toThrow("Add a backlog goal before moving the current goal to tasks.");
    expect(createExecution).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
