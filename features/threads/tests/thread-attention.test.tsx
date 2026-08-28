// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STALE_WORKING_MS, threadNeedsAttention } from "../thread-attention";
import { ThreadStatus } from "../thread-row-presentation";

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

  it("adds a clock over working dots at the 30-minute no-update boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const view = render(
      <ThreadStatus
        thread={thread({
          indicator: "runtime",
          indicatorLabel: "Thread is running",
          createdAt: NOW - STALE_WORKING_MS + 1_000,
          updatedAt: NOW - STALE_WORKING_MS + 1_000,
          latestAttentionAt: NOW - STALE_WORKING_MS + 1_000,
        })}
        hasComposerDraft={false}
      />,
    );

    expect(view.queryByLabelText(/no agent update for 30 minutes/i)).toBeNull();
    act(() => vi.advanceTimersByTime(999));
    expect(view.queryByLabelText(/no agent update for 30 minutes/i)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(view.getByLabelText(/no agent update for 30 minutes/i)).toBeTruthy();
    expect(view.container.querySelector(".ws-status-dots")).toBeTruthy();
  });
});
