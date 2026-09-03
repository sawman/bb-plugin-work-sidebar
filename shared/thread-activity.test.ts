import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";

import {
  THREAD_ACTIVITY_PRESENTATION,
  adaptRuntimeThreadActivity,
  adaptSidebarThreadActivity,
  rollupThreadActivityFacts,
  threadActivityProviderState,
} from "./thread-activity";

function thread(
  id: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "project",
    title: id,
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
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  };
}

describe("canonical thread activity facts", () => {
  it("declares one complete presentation and precedence matrix", () => {
    expect(Object.keys(THREAD_ACTIVITY_PRESENTATION)).toEqual([
      "error",
      "blocked",
      "attention",
      "done",
      "working",
      "queued",
      "idle",
    ]);
    expect(
      Object.values(THREAD_ACTIVITY_PRESENTATION).map(({ precedence }) =>
        precedence,
      ),
    ).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(THREAD_ACTIVITY_PRESENTATION.attention).toMatchObject({
      label: "Waiting",
      tone: "waiting",
    });
    expect(THREAD_ACTIVITY_PRESENTATION.done).toMatchObject({
      label: "Complete",
      tone: "complete",
    });
  });

  it("normalizes host-owned sidebar signals without losing concurrent facts", () => {
    const fact = adaptSidebarThreadActivity(
      thread("thr_error", {
        indicator: "unread-error",
        indicatorLabel: "Provider request failed",
        hasPendingInteraction: true,
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
      }),
      { queuedCount: 2, activeChildCount: 1, childCount: 3 },
    );

    expect(fact).toMatchObject({
      state: "error",
      label: "Provider request failed",
      queuedCount: 2,
      ownWorking: true,
      activeChildCount: 1,
      childCount: 3,
    });
    expect(fact.states).toEqual([
      "error",
      "attention",
      "working",
      "queued",
    ]);
    expect("providerHealth" in fact).toBe(false);
  });

  it("normalizes server runtime status with attention before active work", () => {
    expect(
      adaptRuntimeThreadActivity({
        status: "active",
        runtimeStatus: "waiting_for_input",
      }),
    ).toMatchObject({ state: "attention", ownWorking: true });
    expect(
      adaptRuntimeThreadActivity({ status: "error", runtimeStatus: "idle" }),
    ).toMatchObject({ state: "blocked", ownWorking: false });
    expect(
      adaptRuntimeThreadActivity({ status: "idle", runtimeStatus: "complete" }),
    ).toMatchObject({ state: "done", ownWorking: false });
  });

  it("keeps provider precedence distinct from the canonical fact precedence", () => {
    const workingWithAttention = adaptSidebarThreadActivity(
      thread("thr_pending_work", {
        indicator: "approval" as PluginSidebarThread["indicator"],
        hasPendingInteraction: true,
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
      }),
    );
    expect(workingWithAttention.state).toBe("attention");
    expect(threadActivityProviderState(workingWithAttention)).toBe("working");

    expect(
      threadActivityProviderState(
        adaptSidebarThreadActivity(thread("thr_stale"), { stale: true }),
      ),
    ).toBe("stale");
    expect(
      threadActivityProviderState(
        adaptSidebarThreadActivity(
          thread("thr_blocked_work", {
            indicator: "blocked" as PluginSidebarThread["indicator"],
            activity: {
              workflows: 1,
              backgroundAgents: 0,
              backgroundCommands: 0,
              planMode: 0,
              goals: 0,
            },
          }),
        ),
      ),
    ).toBe("error");
  });

  it("rolls descendant facts up once with the same precedence", () => {
    const facts = new Map([
      ["root", adaptRuntimeThreadActivity({ status: "idle", runtimeStatus: "idle" })],
      ["working", adaptRuntimeThreadActivity({ status: "active", runtimeStatus: "working" })],
      ["done", adaptRuntimeThreadActivity({ status: "idle", runtimeStatus: "done" })],
      ["attention", adaptRuntimeThreadActivity({ status: "idle", runtimeStatus: "waiting_for_input" })],
      [
        "error",
        adaptSidebarThreadActivity(
          thread("error", {
            indicator: "unread-error",
            indicatorLabel: "Provider request failed",
          }),
        ),
      ],
    ]);
    const children = new Map([
      ["root", ["working", "done"]],
      ["working", ["attention"]],
      ["attention", ["error"]],
    ]);

    expect(rollupThreadActivityFacts("root", facts, children)).toMatchObject({
      state: "error",
      label: "Provider request failed",
      childCount: 4,
      activeChildCount: 1,
    });
  });
});
