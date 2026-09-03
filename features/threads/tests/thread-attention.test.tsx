// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STALE_WORKING_MINUTES,
  STALE_WORKING_MS,
  threadGroupActivity,
  threadNeedsAttention,
  threadTreeGroupActivity,
  threadTreeNeedsAttention,
  threadReportsComposerDraft,
  useStaleWorking,
} from "../thread-attention";
import {
  normalizeGroupActivityPriority,
  type GroupActivityPriority,
} from "../group-activity-priority";
import {
  ThreadRuntimeProvider,
  ThreadStatus,
} from "../thread-row-presentation";

const NOW = Date.UTC(2026, 7, 28, 6);

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_attention",
    projectId: "project",
    title: "Attention",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastReadAt: NOW,
    latestAttentionAt: NOW,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("thread attention presentation", () => {
  it("prefers durable host draft state over legacy indicator inference", () => {
    expect(
      threadReportsComposerDraft(
        Object.assign(thread(), { hasComposerDraft: true }),
      ),
    ).toBe(true);
    expect(
      threadReportsComposerDraft(
        Object.assign(thread({ indicator: "draft" }), {
          hasComposerDraft: false,
        }),
      ),
    ).toBe(false);
    expect(threadReportsComposerDraft(thread({ indicator: "draft" }))).toBe(
      true,
    );
  });

  it("ignores generic unread updates and attends only to input, errors, and completion", () => {
    expect(threadNeedsAttention(thread({ isUnread: true }))).toBe(false);
    expect(
      threadNeedsAttention(thread({ indicator: "runtime", isUnread: true })),
    ).toBe(false);
    expect(threadNeedsAttention(thread({ hasPendingInteraction: true }))).toBe(
      true,
    );
    expect(
      threadNeedsAttention(thread({ indicator: "waiting-for-input" })),
    ).toBe(true);
    expect(threadNeedsAttention(thread({ indicator: "unread-error" }))).toBe(
      true,
    );
    expect(threadNeedsAttention(thread({ indicator: "unread-success" }))).toBe(
      true,
    );
  });

  it("promotes actionable descendants to their group header", () => {
    const root = thread({ id: "root" });
    const child = thread({
      id: "child",
      parentThreadId: root.id,
      indicator: "waiting-for-input",
    });
    expect(
      threadTreeNeedsAttention([root], new Map([[root.id, [child]]])),
    ).toBe(true);
    expect(threadTreeNeedsAttention([root], new Map())).toBe(false);
  });

  it("uses one group marker with error, attention, completion, and work priority", () => {
    const root = thread({ id: "root", indicator: "runtime" });
    const completed = thread({
      id: "completed",
      parentThreadId: root.id,
      indicator: "unread-success",
    });
    const waiting = thread({
      id: "waiting",
      parentThreadId: root.id,
      indicator: "waiting-for-input",
    });
    const errored = thread({
      id: "errored",
      parentThreadId: root.id,
      indicator: "unread-error",
    });

    expect(threadGroupActivity(root)).toBe("working");
    expect(threadTreeGroupActivity([root], new Map([[root.id, [completed]]]))).toBe(
      "completed",
    );
    expect(threadTreeGroupActivity([root], new Map([[root.id, [completed, waiting]]]))).toBe(
      "attention",
    );
    expect(
      threadTreeGroupActivity(
        [root],
        new Map([[root.id, [completed, waiting, errored]]]),
      ),
    ).toBe("error");
  });

  it("uses the saved marker ordering while rejecting incomplete orders", () => {
    const root = thread({ id: "root", indicator: "runtime" });
    const completed = thread({
      id: "completed",
      parentThreadId: root.id,
      indicator: "unread-success",
    });
    const priority: GroupActivityPriority = [
      "working",
      "completed",
      "attention",
      "error",
    ];
    expect(
      threadTreeGroupActivity(
        [root],
        new Map([[root.id, [completed]]]),
        priority,
      ),
    ).toBe("working");
    expect(
      normalizeGroupActivityPriority(["error", "error", "working"]),
    ).toEqual(["error", "attention", "completed", "working"]);
  });

  it("does not paint an unread or completion dot", () => {
    const unread = render(
      <ThreadStatus
        thread={thread({ isUnread: true })}
        hasComposerDraft={false}
      />,
    );
    expect(unread.container.querySelector(".ws-unread-dot")).toBeNull();
    expect(unread.container.textContent).not.toContain("•");
    unread.unmount();

    const complete = render(
      <ThreadStatus
        thread={thread({
          indicator: "unread-success",
          indicatorLabel: "Thread completed",
          isUnread: true,
        })}
        hasComposerDraft={false}
      />,
    );
    expect(complete.container.querySelector(".ws-unread-dot")).toBeNull();
    expect(complete.container.textContent).not.toContain("•");
  });

  it("keeps active work shining on the provider while returning its stale clock to trailing status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const staleThread = thread({
      indicator: "runtime",
      indicatorLabel: "Thread is running",
      isPinned: true,
      createdAt: NOW - STALE_WORKING_MS + 1_000,
      updatedAt: NOW - STALE_WORKING_MS + 1_000,
      latestAttentionAt: NOW - STALE_WORKING_MS + 1_000,
    });
    function RuntimeState() {
      const staleWorking = useStaleWorking(staleThread);
      return (
        <>
          <ThreadRuntimeProvider
            thread={staleThread}
            staleWorking={staleWorking}
          />
          <ThreadStatus
            thread={staleThread}
            hasComposerDraft={false}
            staleWorking={staleWorking}
          />
        </>
      );
    }
    const view = render(<RuntimeState />);

    expect(view.queryByLabelText(/no agent update for 30 minutes/i)).toBeNull();
    act(() => vi.advanceTimersByTime(999));
    expect(view.queryByLabelText(/no agent update for 30 minutes/i)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(
      view.getAllByRole("img", {
        name: /no agent update for 30 minutes/i,
      }),
    ).toHaveLength(2);
    const provider = view.getByRole("img", {
      name: "codex provider status: Thread is running; no agent update for 30 minutes",
    });
    expect(provider.getAttribute("data-runtime-state")).toBe("working");
    expect(provider.querySelector(".ws-status-stale-clock")).toBeNull();
    expect(
      view.container.querySelector(
        ".ws-thread-trailing .ws-status-stale-clock",
      ),
    ).toBeTruthy();
    expect(view.container.querySelector(".ws-status-dots")).toBeNull();
  });

  it("treats a durable goal as activity and honors a configured threshold", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const goalThread = thread({
      indicator: "none",
      indicatorLabel: "Goal active",
      activity: {
        workflows: 0,
        backgroundAgents: 0,
        backgroundCommands: 0,
        planMode: 0,
        goals: 1,
      },
      createdAt: NOW - 10 * 60_000,
      updatedAt: NOW - 10 * 60_000,
      latestAttentionAt: NOW - 10 * 60_000,
    });
    function GoalState() {
      const staleWorking = useStaleWorking(goalThread, 10);
      return (
        <>
          <ThreadRuntimeProvider
            thread={goalThread}
            staleWorking={staleWorking}
            staleWorkingMinutes={10}
          />
          <ThreadStatus
            thread={goalThread}
            hasComposerDraft={false}
            staleWorking={staleWorking}
            staleWorkingMinutes={10}
          />
        </>
      );
    }

    const view = render(<GoalState />);
    expect(
      view.getByRole("img", {
        name: "Goal active; no agent update for 10 minutes",
      }),
    ).toBeTruthy();
    expect(
      view.getByRole("img", {
        name: "codex provider status: Goal active; no agent update for 10 minutes",
      }).getAttribute("data-runtime-state"),
    ).toBe("working");
    expect(DEFAULT_STALE_WORKING_MINUTES).toBe(30);
  });

  it("announces aggregate thread and child activity on the provider icon", () => {
    const view = render(
      <ThreadRuntimeProvider
        thread={thread({
          indicator: "runtime",
          indicatorLabel: "Thread is running",
        })}
        activeChildren={2}
        staleWorking={false}
      />,
    );

    expect(
      view.getByRole("img", {
        name: /Thread is running; 2 child agents working/i,
      }),
    ).toBeTruthy();
  });
});
