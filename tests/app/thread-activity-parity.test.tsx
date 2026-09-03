// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentRuntimeIndicator } from "../../features/agents/agent-row";
import {
  ThreadRuntimeProvider,
  ThreadStatus,
} from "../../features/threads/thread-row-presentation";
import type { QueuedMessage } from "../../features/threads/schemas";
import { WorkRuntimeIndicator } from "../../features/work-context/status-card";
import {
  THREAD_ACTIVITY_PRESENTATION,
  adaptSidebarThreadActivity,
  type ThreadActivityState,
} from "../../shared/thread-activity";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

const NOW = Date.UTC(2026, 8, 3, 12);

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_parity",
    projectId: "project",
    title: "Parity",
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

const queuedMessage: QueuedMessage = {
  threadId: "thr_parity",
  count: 2,
  nextSendAt: NOW + 60 * 60_000,
  waitingLabel: "Waiting for provider",
  retryReason: "Rate limited",
};

const cases: readonly [
  ThreadActivityState,
  Partial<PluginSidebarThread>,
][] = [
  ["error", { indicator: "unread-error" }],
  [
    "blocked",
    { indicator: "blocked" as PluginSidebarThread["indicator"] },
  ],
  [
    "attention",
    { indicator: "waiting-for-input", hasPendingInteraction: true },
  ],
  ["done", { indicator: "unread-success" }],
  ["working", { indicator: "runtime" }],
  ["idle", { indicator: "none" }],
];

describe("mounted thread activity parity", () => {
  it.each(cases)(
    "uses the canonical %s fact across Threads, Agents, and Work",
    (state, overrides) => {
      const source = thread(overrides);
      const fact = adaptSidebarThreadActivity(source);
      const view = render(
        <>
          <section data-surface="threads">
            <ThreadRuntimeProvider thread={source} staleWorking={false} />
          </section>
          <section data-surface="agents">
            <AgentRuntimeIndicator fact={fact} />
          </section>
          <section data-surface="work">
            <WorkRuntimeIndicator fact={fact} />
          </section>
        </>,
      );

      for (const surface of ["threads", "agents", "work"]) {
        const root = view.container.querySelector(
          `[data-surface="${surface}"]`,
        )!;
        expect(
          root.querySelector(`[data-thread-activity-state="${state}"]`),
        ).toBeTruthy();
      }
      const agentIcon = view.container.querySelector(
        '[data-surface="agents"] svg',
      );
      const workIcon = view.container.querySelector(
        '[data-surface="work"] svg',
      );
      expect(agentIcon?.innerHTML).toBe(workIcon?.innerHTML);
      expect(
        view.container.querySelector('[data-surface="agents"] [role="img"]')
          ?.getAttribute("aria-label"),
      ).toBe(THREAD_ACTIVITY_PRESENTATION[state].label);
    },
  );

  it("uses the canonical queued fact only for trailing queue UI", () => {
    const source = thread();
    const fact = adaptSidebarThreadActivity(source, { queuedCount: 2 });
    const view = render(
      <>
        <section data-surface="threads">
          <ThreadRuntimeProvider thread={source} staleWorking={false} />
          <ThreadStatus
            thread={source}
            hasComposerDraft={false}
            queuedMessage={queuedMessage}
            queuedMessageNow={NOW}
          />
        </section>
        <section data-surface="agents">
          <AgentRuntimeIndicator fact={fact} />
        </section>
        <section data-surface="work">
          <WorkRuntimeIndicator fact={fact} />
        </section>
      </>,
    );

    for (const surface of ["threads", "agents", "work"]) {
      const root = view.container.querySelector(
        `[data-surface="${surface}"]`,
      )!;
      expect(
        root.querySelector('[data-thread-activity-state="queued"]'),
      ).toBeTruthy();
    }
    expect(
      view.container
        .querySelector('[data-surface="threads"] .ws-thread-provider')
        ?.getAttribute("data-runtime-state"),
    ).toBe("idle");
    expect(
      view.getByRole("status", {
        name: "2 queued messages · next sends in 1h · Rate limited",
      }).textContent,
    ).toBe("2 · 1h");
    const queuedIcon = view.container.querySelector(
      '[data-surface="threads"] .ws-queued-message svg',
    );
    const canonicalIcon = view.container.querySelector(
      '[data-surface="agents"] svg',
    );
    expect(queuedIcon?.innerHTML).toBe(canonicalIcon?.innerHTML);
  });
});
