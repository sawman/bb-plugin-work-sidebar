import { describe, expect, it, vi } from "vitest";
import {
  createWorkItemQueueService,
  normalizeWorkItemQueue,
} from "../work-item-queue-server";

describe("durable work-item queue", () => {
  it("distinguishes an absent queue from a deliberately empty queue", async () => {
    let stored: unknown = {};
    const service = createWorkItemQueueService({
      get: async () => stored,
      set: async (next) => { stored = next; },
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
    let stored: unknown = {
      thr_root: {
        current: { source: "linear", id: "LIN-1" },
        backlog: [{ source: "bb_task", id: "task-2" }],
      },
    };
    const createExecution = vi.fn(async () => ({ task: { id: "task-execution" } }));
    const publish = vi.fn();
    const service = createWorkItemQueueService({
      get: async () => stored,
      set: async (next) => { stored = next; },
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
    expect(normalizeWorkItemQueue((stored as Record<string, unknown>).thr_root)).toEqual({
      current: { source: "bb_task", id: "task-2" },
      backlog: [],
    });
  });

  it("requires a backlog replacement before moving the sole current goal to tasks", async () => {
    const createExecution = vi.fn(async () => ({ task: { id: "task-execution" } }));
    const publish = vi.fn();
    const service = createWorkItemQueueService({
      get: async () => ({ thr_root: { current: { source: "linear", id: "LIN-1" }, backlog: [] } }),
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
