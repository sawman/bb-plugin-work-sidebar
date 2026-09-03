import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { createWorkContextRegistration } from "../server-registration";

function timelineFixture() {
  return {
    rows: [
      {
        kind: "conversation",
        role: "user",
        text: "Run the focused suite",
        createdAt: 100,
      },
    ],
    goal: {
      objective: "Ship the snapshot",
      status: "active" as const,
      tokensUsed: 12,
      tokenBudget: 100,
      timeUsedSeconds: 3,
    },
    pendingTodos: {
      items: [
        { id: "one", text: "Add tests", status: "in_progress" as const },
      ],
    },
    activeBackgroundCommands: [
      {
        id: "watch",
        description: "Watch tests",
        summary: null,
        error: null,
        taskType: "monitor",
        taskStatus: "running" as const,
        startedAt: 100,
        completedAt: null,
        model: "gpt-5.6-terra",
        workflowName: null,
      },
    ],
    activeWorkflows: [],
  };
}

function registration() {
  const eventHandlers = new Map<string, (event: { thread: { id: string } }) => void>();
  const timeline = vi.fn(async (_input: { threadId: string }) =>
    timelineFixture(),
  );
  const lifecycle = createServerLifecycle();
  const work = createWorkContextRegistration({
    bb: {
      events: {
        on: vi.fn((event, handler) => {
          eventHandlers.set(event, handler);
        }),
      },
      realtime: { publish: vi.fn() },
      storage: { kv: { get: vi.fn(), set: vi.fn() } },
      sdk: {
        threads: {
          timeline,
          get: vi.fn(async () => ({
            status: "active",
            runtime: { displayStatus: "active" },
          })),
          output: vi.fn(async () => ({ output: "Focused suite is green" })),
        },
        system: { providerStates: vi.fn(), usageLimits: vi.fn() },
      },
    } as never,
    lifecycle,
    tasks: {} as never,
  });
  return { eventHandlers, lifecycle, timeline, work };
}

describe("registered Work timeline selectors", () => {
  it("shares full reads while keeping the five-second background read narrow", async () => {
    const { timeline, work } = registration();

    const [goal, plan, background, activity] = await Promise.all([
      work.getWorkGoal({ threadId: "thr_child" }),
      work.getWorkPlan({ threadId: "thr_child" }),
      work.getWorkBackgroundJobs({ threadId: "thr_child" }),
      work.getLatestActivity({ threadId: "thr_child" }),
    ]);

    expect(timeline).toHaveBeenCalledTimes(2);
    expect(timeline).toHaveBeenCalledWith({ threadId: "thr_child" });
    expect(timeline).toHaveBeenCalledWith({
      threadId: "thr_child",
      summaryOnly: "true",
      segmentLimit: "1",
    });
    expect(goal).toMatchObject({ objective: "Ship the snapshot" });
    expect(plan).toEqual({
      items: [{ id: "one", text: "Add tests", status: "in_progress" }],
    });
    expect(background).toMatchObject({ items: [{ id: "watch" }] });
    expect(activity).toMatchObject({
      latest: { text: "Focused suite is green", kind: "assistant" },
      lastUser: { text: "Run the focused suite", kind: "user" },
    });

    await work.getWorkGoal({ threadId: "thr_root" });
    expect(timeline).toHaveBeenCalledTimes(3);
    expect(timeline).toHaveBeenLastCalledWith({ threadId: "thr_root" });
  });

  it("invalidates only the announced thread and disposes with the server lifecycle", async () => {
    const { eventHandlers, lifecycle, timeline, work } = registration();
    await Promise.all([
      work.getWorkGoal({ threadId: "thr_one" }),
      work.getWorkBackgroundJobs({ threadId: "thr_one" }),
      work.getWorkGoal({ threadId: "thr_two" }),
      work.getWorkBackgroundJobs({ threadId: "thr_two" }),
    ]);
    expect(timeline).toHaveBeenCalledTimes(4);

    eventHandlers.get("thread.idle")!({ thread: { id: "thr_one" } });
    await Promise.all([
      work.getWorkPlan({ threadId: "thr_one" }),
      work.getWorkPlan({ threadId: "thr_two" }),
      work.getWorkBackgroundJobs({ threadId: "thr_one" }),
      work.getWorkBackgroundJobs({ threadId: "thr_two" }),
    ]);
    expect(timeline).toHaveBeenCalledTimes(6);
    expect(
      timeline.mock.calls.filter(([input]) => input.threadId === "thr_one"),
    ).toHaveLength(4);
    expect(
      timeline.mock.calls.filter(([input]) => input.threadId === "thr_two"),
    ).toHaveLength(2);

    lifecycle.dispose();
    await expect(
      work.getWorkBackgroundJobs({ threadId: "thr_one" }),
    ).rejects.toThrow("Work timeline snapshot service is disposed.");

    eventHandlers.get("thread.idle")!({ thread: { id: "thr_one" } });
    expect(timeline).toHaveBeenCalledTimes(6);
  });
});
