// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { getPluginQueryClient } from "../../../query-runtime";

const retry = {
  id: "queued_retry",
  threadId: "thr_retry",
  reason: "Rate limited",
  attempt: 2,
  sendAt: 1_800_000_065_000,
};

const thread = {
  id: retry.threadId,
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

describe("provider retry sidebar lifecycle", () => {
  it("renders queued retries and refreshes only for its realtime signal", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const listRetries = vi
      .fn()
      .mockResolvedValueOnce({ retries: [retry] })
      .mockResolvedValueOnce({ retries: [] });
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
          sidebarProviderRetries: listRetries,
          sidebarArchivedThreads: () => ({ available: true, threads: [], error: null }),
        } as never,
      },
    );
    await slot.findByRole("status", { name: /Rate limited; retry 2/i });
    expect(listRetries).toHaveBeenCalledTimes(1);
    await slot.behavior.emitRealtime("work-sidebar:changed", { family: "provider-retry", threadId: retry.threadId });
    await waitFor(() => expect(listRetries).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(slot.queryByRole("status", { name: /Rate limited; retry 2/i })).toBeNull());
    slot.unmount();
    getPluginQueryClient().clear();
  });
});
