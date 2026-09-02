// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThreadStatus } from "../thread-row-presentation";
import { providerRetryCountdown, providerRetryLabel } from "../provider-retry";
import type { ProviderRetry } from "../schemas";

const NOW = 1_800_000_000_000;
const retry: ProviderRetry = {
  id: "queued_retry",
  threadId: "thr_retry",
  reason: "Rate limited",
  attempt: 2,
  sendAt: NOW + 65_000,
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

describe("provider retry presentation and read contract", () => {
  it("shows a compact countdown while keeping the full retry reason available", () => {
    expect(providerRetryCountdown(retry, NOW)).toBe("1m");
    expect(providerRetryLabel(retry, NOW)).toBe(
      "Rate limited; retry 2 in 1m.",
    );
    const view = render(
      <ThreadStatus
        thread={thread}
        hasComposerDraft={false}
        providerRetry={retry}
        providerRetryNow={NOW}
      />,
    );
    const status = view.getByRole("status", {
      name: "Rate limited; retry 2 in 1m.",
    });
    expect(status.textContent).toBe("1m");
    expect(status.querySelector('[data-icon="Clock"]')).toBeTruthy();
    expect(status.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document
        .getElementById(status.getAttribute("aria-describedby") ?? "")
        ?.getAttribute("aria-label"),
    ).toBe(
      "Rate limited; retry 2 in 1m.",
    );
    view.unmount();
  });
});
