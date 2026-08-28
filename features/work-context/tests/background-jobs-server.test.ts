import { describe, expect, it } from "vitest";
import {
  createBackgroundJobsReadService,
  projectBackgroundJobs,
} from "../background-jobs-server";

const backgroundItem = (
  id: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  description: `Background ${id}`,
  summary: null,
  error: null,
  taskType: "monitor",
  taskStatus: "running" as const,
  startedAt: 100,
  completedAt: null,
  model: "gpt-5.6-terra",
  workflowName: null,
  presentation: undefined,
  ...overrides,
});

describe("provider background jobs projection", () => {
  it("deduplicates commands and workflows while preserving host presentation", () => {
    expect(
      projectBackgroundJobs({
        activeBackgroundCommands: [
          backgroundItem("command", {
            presentation: {
              title: "Watch tests",
              detail: "vitest --watch",
              label: { pending: "Watching", completed: "Watched" },
              icon: { glyph: "pulse" },
            },
          }),
          backgroundItem("shared", { description: "Shared command" }),
          backgroundItem("hidden", {
            presentation: {
              suppress: true,
              label: { pending: "Hidden", completed: "Hidden" },
              icon: { glyph: "dot" },
            },
          }),
        ],
        activeWorkflows: [
          backgroundItem("shared", {
            description: "Shared command",
            workflowName: "release-monitor",
          }),
          backgroundItem("workflow", {
            workflowName: "nightly-index",
            taskType: "cron",
            taskStatus: "paused",
            summary: "Waiting for the next window",
          }),
        ],
      }),
    ).toEqual({
      items: [
        {
          id: "command",
          kind: "command",
          title: "Watch tests",
          detail: "vitest --watch",
          taskType: "monitor",
          status: "running",
          startedAt: 100,
          completedAt: null,
          model: "gpt-5.6-terra",
        },
        {
          id: "shared",
          kind: "workflow",
          title: "release-monitor",
          detail: "Shared command",
          taskType: "monitor",
          status: "running",
          startedAt: 100,
          completedAt: null,
          model: "gpt-5.6-terra",
        },
        {
          id: "workflow",
          kind: "workflow",
          title: "nightly-index",
          detail: "Waiting for the next window",
          taskType: "cron",
          status: "paused",
          startedAt: 100,
          completedAt: null,
          model: "gpt-5.6-terra",
        },
      ],
    });
  });

  it("reads one summary timeline for the selected thread", async () => {
    const calls: unknown[] = [];
    const service = createBackgroundJobsReadService({
      timeline: async (input) => {
        calls.push(input);
        return {
          activeBackgroundCommands: [backgroundItem("daemon")],
          activeWorkflows: [],
        };
      },
    });

    await expect(service.read("thr_jobs")).resolves.toMatchObject({
      items: [{ id: "daemon", kind: "command", status: "running" }],
    });
    expect(calls).toEqual([
      { threadId: "thr_jobs", summaryOnly: "true", segmentLimit: "1" },
    ]);
  });
});
