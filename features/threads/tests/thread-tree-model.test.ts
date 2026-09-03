import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { threadAgentRollups } from "../thread-agent-rollup";

function thread(
  id: string,
  parentThreadId: string | null,
  indicator: PluginSidebarThread["indicator"] = "none",
): PluginSidebarThread {
  return {
    id,
    parentThreadId,
    projectId: "project",
    title: id,
    titleFallback: null,
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
    indicator,
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
  };
}

describe("thread agent rollups", () => {
  it("counts all descendants and their activity once for each parent row", () => {
    const root = thread("root", null);
    const child = thread("child", root.id, "runtime");
    const grandchild = thread("grandchild", child.id, "runtime");
    const sibling = thread("sibling", root.id);
    const rollups = threadAgentRollups(
      [root],
      new Map([
        [root.id, [child, sibling]],
        [child.id, [grandchild]],
      ]),
    );

    expect(rollups.get(root.id)).toEqual({
      childCount: 3,
      activeChildCount: 2,
    });
    expect(rollups.get(child.id)).toEqual({
      childCount: 1,
      activeChildCount: 1,
    });
    expect(rollups.get(sibling.id)).toEqual({
      childCount: 0,
      activeChildCount: 0,
    });
  });
});
