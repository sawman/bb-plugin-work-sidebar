// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { getPluginQueryClient } from "../../query-runtime";
import { sidebarThreadFixture } from "../utils/sidebar-thread";

const host = vi.hoisted(() => ({
  sidebarThreads: { status: "loading", threads: [], projects: [] } as unknown,
}));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...actual,
    experimental_useSidebarThreads: () => host.sidebarThreads,
  };
});

describe("R19A registered left-slot transitions", () => {
  it("keeps one mounted registered slot hook-safe through loading → ready → error", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    const props = {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => undefined,
      searchQuery: "",
    };
    const slot = renderSlot(app.threadLists[0]!, props);
    expect(slot.getByRole("status").textContent).toBe("Loading threads…");

    host.sidebarThreads = {
      status: "ready",
      projects: [{ id: "project", name: "Project", isPersonal: false, href: "/projects/project", settingsHref: "/projects/project/settings" }],
      threads: [
        {
          ...sidebarThreadFixture(),
          id: "thr_ready",
          projectId: "project",
          title: "Ready",
          displayTitle: "Ready",
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
          createdAt: 0,
          updatedAt: 0,
          lastReadAt: null,
          latestAttentionAt: 0,
        },
      ],
    };
    slot.lifecycle.rerender(
      createElement(app.threadLists[0]!.component, props),
    );
    await waitFor(() =>
      expect(slot.getByRole("link", { name: /Ready/ })).toBeTruthy(),
    );

    host.sidebarThreads = { status: "error", threads: [], projects: [] };
    slot.lifecycle.rerender(
      createElement(app.threadLists[0]!.component, props),
    );
    expect(slot.getByRole("alert").textContent).toBe("Threads unavailable");
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });
});
