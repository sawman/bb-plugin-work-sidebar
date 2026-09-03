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

const NOW = 1_800_000_000_000;
const queuedMessage: QueuedMessage = {
  threadId: "thr_retry",
  count: 2,
  nextSendAt: NOW + 65 * 60_000,
  waitingLabel: "Retry: Rate limited",
  retryReason: "Rate limited",
};

const thread = {
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
  it("shows count and a minutes-only countdown while keeping the reason in its tooltip", () => {
    expect(queuedMessageCountdown(queuedMessage, NOW)).toBe("65m");
    expect(queuedMessageDisplay(queuedMessage, NOW)).toBe("2 · 65m");
    expect(queuedMessageReason(queuedMessage)).toBe("Rate limited");
    expect(queuedMessageLabel(queuedMessage, NOW)).toBe(
      "2 queued messages · next sends in 65m · Rate limited",
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
      name: "2 queued messages · next sends in 65m · Rate limited",
    });
    expect(status.textContent).toBe("2 · 65m");
    expect(status.querySelector('[data-icon="MessageSquare"]')).toBeTruthy();
    expect(status.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document
        .getElementById(status.getAttribute("aria-describedby") ?? "")
        ?.getAttribute("aria-label"),
    ).toBe("Rate limited");
    view.unmount();
  });
});
