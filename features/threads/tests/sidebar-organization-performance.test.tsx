// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useSidebarThreadOrganization } from "../sidebar-organization";
import { threadInteractionStore } from "../store";

describe("Threads organization lifecycle", () => {
  it("does not let stale stored thread ids keep an otherwise empty group occupied", () => {
    const saveGroups = vi.fn(async () => undefined);
    const staleGroup = {
      id: "group_stale",
      name: "Stale",
      threadIds: ["thr_removed"],
    };
    const liveGroup = {
      id: "group_live",
      name: "Live",
      threadIds: ["thr_live"],
    };
    const threads = [{ id: "thr_live" }] as PluginSidebarThread[];
    const view = renderHook(() =>
      useSidebarThreadOrganization({
        active: true,
        threads,
        hierarchyThreads: threads,
        projects: [],
        order: [],
        groups: [staleGroup, liveGroup],
        activeGroupPosition: 0,
        searchQuery: "",
        saveGroups,
        saveOrder: vi.fn(),
      }),
    );

    expect(view.result.current.occupiedGroupIds).not.toContain(staleGroup.id);
    expect(view.result.current.occupiedGroupIds).toContain(liveGroup.id);

    act(() => view.result.current.removeGroup(staleGroup));
    expect(saveGroups).toHaveBeenCalledWith([liveGroup], 0);

    act(() => view.result.current.removeGroup(liveGroup));
    expect(saveGroups).toHaveBeenCalledTimes(1);
  });

  it("does not traverse host records or subscribe to presentation state while its tab is inactive", () => {
    const threads: PluginSidebarThread[] = [];
    const projects: { id: string; name: string; isPersonal: boolean }[] = [];
    const groups: { id: string; name: string; threadIds: string[] }[] = [];
    const threadMap = vi.spyOn(threads, "map");
    const threadFilter = vi.spyOn(threads, "filter");
    const projectMap = vi.spyOn(projects, "map");
    const groupMap = vi.spyOn(groups, "map");
    let renders = 0;
    const props = {
      active: false,
      threads,
      projects,
      order: [] as string[],
      groups,
      activeGroupPosition: 0,
      searchQuery: "",
      saveGroups: vi.fn(),
      saveOrder: vi.fn(),
      archive: vi.fn(async () => undefined),
    };
    const view = renderHook(
      ({ active }) => {
        renders += 1;
        return useSidebarThreadOrganization({ ...props, active });
      },
      { initialProps: { active: false } },
    );

    expect(threadMap).not.toHaveBeenCalled();
    expect(threadFilter).not.toHaveBeenCalled();
    expect(projectMap).not.toHaveBeenCalled();
    expect(groupMap).not.toHaveBeenCalled();
    expect(view.result.current.filtered).toEqual([]);
    expect(renders).toBe(1);

    act(() => {
      threadInteractionStore.getState().setSelected("thr_hidden", [
        "thr_hidden",
      ]);
      threadInteractionStore
        .getState()
        .setDrag("thr_hidden", {
          kind: "reorder",
          threadId: "thr_hidden",
          placement: "after",
        });
    });
    expect(renders).toBe(1);

    view.rerender({ active: true });
    expect(threadMap).toHaveBeenCalled();
    expect(threadFilter).not.toHaveBeenCalled();
    expect(projectMap).toHaveBeenCalled();
    expect(groupMap).toHaveBeenCalled();
    act(() => {
      threadInteractionStore.getState().setSelected(null, []);
      threadInteractionStore.getState().setDrag(null, null);
    });
  });
});
