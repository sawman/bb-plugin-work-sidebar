import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { describe, expect, it } from "vitest";
import {
  agentRuntimePresentation,
  agentWorkspacePresentation,
  projectAgentChildren,
} from "../model";

function thread(
  id: string,
  parentThreadId: string | null,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "project",
    title: id,
    titleFallback: null,
    parentThreadId,
    sectionId: null,
    originKind: "fork",
    originPluginId: "work-sidebar",
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
    ...overrides,
  };
}

describe("Agents projection model", () => {
  it("projects direct and recursive children in host roster order with depth", () => {
    const result = projectAgentChildren([
      thread("thr_root", null),
      thread("thr_direct", "thr_root"),
      thread("thr_grandchild", "thr_direct"),
      thread("thr_second", "thr_root"),
    ], "thr_root");

    expect(result.map(({ thread: child, depth }) => [child.id, depth])).toEqual([
      ["thr_direct", 1],
      ["thr_grandchild", 2],
      ["thr_second", 1],
    ]);
  });

  it("filters archived branches and never projects the requested parent", () => {
    const result = projectAgentChildren([
      thread("thr_root", null),
      thread("thr_archived", "thr_root", { isArchived: true }),
      thread("thr_archived_grandchild", "thr_archived"),
      thread("thr_live", "thr_root"),
    ], "thr_root");

    expect(result.map(({ thread: child }) => child.id)).toEqual(["thr_live"]);
  });

  it("maps goal, background, workflow, plan, and runtime host signals to working", () => {
    expect(agentRuntimePresentation(thread("thr_goal", "thr_root", { indicator: "goal" }))).toEqual({ label: "Working", tone: "working" });
    expect(agentRuntimePresentation(thread("thr_background", "thr_root", { indicator: "background-agent" }))).toEqual({ label: "Working", tone: "working" });
    expect(agentRuntimePresentation(thread("thr_background_command", "thr_root", { indicator: "background-command" }))).toEqual({ label: "Working", tone: "working" });
    expect(agentRuntimePresentation(thread("thr_workflow", "thr_root", { indicator: "workflow" }))).toEqual({ label: "Working", tone: "working" });
    expect(agentRuntimePresentation(thread("thr_plan", "thr_root", { indicator: "plan-mode" }))).toEqual({ label: "Working", tone: "working" });
    expect(agentRuntimePresentation(thread("thr_runtime", "thr_root", { indicator: "runtime" }))).toEqual({ label: "Working", tone: "working" });
    expect(agentRuntimePresentation(thread("thr_counted", "thr_root", { activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 1 } }))).toEqual({ label: "Working", tone: "working" });
  });

  it("gives error and waiting signals precedence over active counts", () => {
    expect(agentRuntimePresentation(thread("thr_error", "thr_root", { indicator: "unread-error", hasPendingInteraction: true, activity: { workflows: 1, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }))).toEqual({ label: "Blocked", tone: "blocked" });
    expect(agentRuntimePresentation(thread("thr_waiting", "thr_root", { indicator: "waiting-for-input", activity: { workflows: 1, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }))).toEqual({ label: "Waiting", tone: "waiting" });
    expect(agentRuntimePresentation(thread("thr_complete", "thr_root", { indicator: "unread-success" }))).toEqual({ label: "Complete", tone: "complete" });
  });

  it("presents the branch, named worktree, and host fallback without inventing workspace data", () => {
    expect(agentWorkspacePresentation(thread("thr_worktree", "thr_root", {
      environment: {
        id: "env_1",
        name: "R24 Agents",
        branchName: "bb/r24-agents",
        workspaceDisplayKind: "managed-worktree",
      },
      host: { id: "host_1", name: "Matthew's Mac" },
    }))).toEqual({
      label: "bb/r24-agents",
      detail: "R24 Agents worktree",
    });

    expect(agentWorkspacePresentation(thread("thr_host", "thr_root", {
      host: { id: "host_1", name: "Matthew's Mac" },
    }))).toEqual({
      label: "Matthew's Mac",
      detail: "Host workspace",
    });
    expect(agentWorkspacePresentation(thread("thr_unknown", "thr_root"))).toBeNull();
  });
});
