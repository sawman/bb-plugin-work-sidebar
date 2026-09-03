// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { getPluginQueryClient } from "../../../query-runtime";

const queuedMessage = {
  threadId: "thr_retry",
  count: 2,
  nextSendAt: 1_800_000_065_000,
  waitingLabel: "Retry: Rate limited",
  retryReason: "Rate limited",
};

const thread = {
  id: queuedMessage.threadId,
  projectId: "project",
  title: "Retry me",
  titleFallback: null,
  parentThreadId: null,
  sectionId: null,
  originKind: null,
  originPluginId: null,
  providerId: "codex",
  hasPendingInteraction: false,
  activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
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

describe("queued message sidebar lifecycle", () => {
  it("renders queued messages and refreshes only for its realtime signal", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const listQueuedMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [queuedMessage] })
      .mockResolvedValueOnce({ messages: [] });
    const slot = renderSlot(
      app.threadLists[0]!,
      { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "", Original: () => null },
      {
        sidebarThreads: { status: "ready", projects: [{ id: "project", name: "Project", isPersonal: false }], threads: [thread] },
        rpc: {
          getSidebarAppearance: () => ({ rowHeight: 40, textScale: 1, workingProviderAnimation: "slow-spin" }),
          getSidebarOrder: () => ({ threadIds: [] }),
          getThreadGroups: () => ({ groups: [] }),
          getRecycleBin: () => ({ entries: [] }),
          sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
          sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
          sidebarQueuedMessages: listQueuedMessages,
          sidebarArchivedThreads: () => ({ available: true, threads: [], error: null }),
        } as never,
      },
    );
    await slot.findByRole("status", { name: /2 queued messages.*Rate limited/i });
    expect(listQueuedMessages).toHaveBeenCalledTimes(1);
    await slot.behavior.emitRealtime("work-sidebar:changed", { family: "queued-message", threadId: queuedMessage.threadId });
    await waitFor(() => expect(listQueuedMessages).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(slot.queryByRole("status", { name: /2 queued messages.*Rate limited/i })).toBeNull());
    slot.unmount();
    getPluginQueryClient().clear();
  });
});
