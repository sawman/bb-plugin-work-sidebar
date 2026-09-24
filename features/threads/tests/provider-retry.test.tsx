// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThreadStatus } from "../thread-row-presentation";
import {
  queuedMessageCountdown,
  queuedMessageDisplay,
  queuedMessageLabel,
  queuedMessageReason,
} from "../queued-messages";
import type { QueuedMessage } from "../schemas";
import { sidebarThreadFixture } from "../../../tests/utils/sidebar-thread";

const NOW = 1_800_000_000_000;
const queuedMessage: QueuedMessage = {
  threadId: "thr_retry",
  count: 2,
  nextSendAt: NOW + 65 * 60_000,
  waitingLabel: "Retry: Rate limited",
  retryReason: "Rate limited",
};

const thread = {
  ...sidebarThreadFixture(),
  id: "thr_retry",
  projectId: "project",
  title: "Retry me",
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
  indicator: "unread-error",
  indicatorLabel: "Provider failed",
  isUnread: true,
  isPinned: false,
  isArchived: false,
  environment: null,
  host: null,
  createdAt: 0,
  updatedAt: 0,
  lastReadAt: null,
  latestAttentionAt: 0,
} as const;

describe("queued message presentation and read contract", () => {
  it.each([
    { minutes: 1, label: "1m" },
    { minutes: 59, label: "59m" },
    { minutes: 60, label: "1h" },
    { minutes: 65, label: "2h" },
    { minutes: 23 * 60, label: "23h" },
    { minutes: 23 * 60 + 1, label: "24h" },
    { minutes: 24 * 60, label: "1d" },
    { minutes: 24 * 60 + 1, label: "2d" },
    { minutes: 48 * 60, label: "2d" },
  ])("rounds $minutes minutes to the largest unit ($label)", ({ minutes, label }) => {
    const message = { ...queuedMessage, nextSendAt: NOW + minutes * 60_000 };
    expect(queuedMessageCountdown(message, NOW)).toBe(label);
  });

  it("shows count and a rounded hour countdown while keeping the reason in its tooltip", () => {
    expect(queuedMessageCountdown(queuedMessage, NOW)).toBe("2h");
    expect(queuedMessageDisplay(queuedMessage, NOW)).toBe("2 · 2h");
    expect(queuedMessageReason(queuedMessage)).toBe("Rate limited");
    expect(queuedMessageLabel(queuedMessage, NOW)).toBe(
      "2 queued messages · next sends in 2h · Rate limited",
    );
    const view = render(
      <ThreadStatus
        thread={thread}
        hasComposerDraft={false}
        queuedMessage={queuedMessage}
        queuedMessageNow={NOW}
      />,
    );
    const status = view.getByRole("status", {
      name: "2 queued messages · next sends in 2h · Rate limited",
    });
    expect(status.textContent).toBe("2 · 2h");
    expect(status.querySelector('[data-icon="Clock"]')).toBeTruthy();
    expect(status.querySelector("[data-message-bubble]")).toBeNull();
    expect(status.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document
        .getElementById(status.getAttribute("aria-describedby") ?? "")
        ?.getAttribute("aria-label"),
    ).toBe("Rate limited");
    view.unmount();
  });

  it("keeps an unscheduled queue as a message bubble", () => {
    const view = render(
      <ThreadStatus
        thread={thread}
        hasComposerDraft={false}
        queuedMessage={{ ...queuedMessage, count: 3, nextSendAt: null }}
        queuedMessageNow={NOW}
      />,
    );
    const status = view.getByRole("status", { name: /3 queued messages/i });
    expect(status.querySelector('[data-icon="MessageSquare"]')).toBeTruthy();
    expect(status.querySelector("[data-message-bubble]")).toBeTruthy();
    expect(status.getAttribute("data-scheduled")).toBeNull();
    view.unmount();
  });
});
