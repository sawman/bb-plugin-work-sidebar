type TimelineBackgroundItem = {
  id: string;
  description: string;
  summary: string | null;
  error: string | null;
  taskType: string;
  taskStatus:
    | "completed"
    | "failed"
    | "killed"
    | "paused"
    | "pending"
    | "running"
    | "stopped";
  startedAt: number;
  completedAt: number | null;
  model: string | null;
  workflowName: string | null;
  presentation?: {
    detail?: string;
    suppress?: boolean;
    title?: string;
  };
};

type BackgroundTimeline = {
  activeBackgroundCommands: readonly TimelineBackgroundItem[];
  activeWorkflows: readonly TimelineBackgroundItem[];
};

export type BackgroundJobsDependencies = {
  timeline(input: {
    threadId: string;
    summaryOnly: "true";
    segmentLimit: "1";
  }): Promise<BackgroundTimeline>;
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function projectItem(
  item: TimelineBackgroundItem,
  kind: "command" | "workflow",
) {
  const description = nonEmpty(item.description);
  const title =
    nonEmpty(item.presentation?.title) ??
    nonEmpty(item.workflowName) ??
    description ??
    item.taskType;
  const detail =
    nonEmpty(item.presentation?.detail) ??
    nonEmpty(item.summary) ??
    nonEmpty(item.error) ??
    (description !== title ? description : null);
  return {
    id: item.id,
    kind,
    title,
    detail,
    taskType: item.taskType,
    status: item.taskStatus,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    model: item.model,
  };
}

export function projectBackgroundJobs(timeline: BackgroundTimeline) {
  const items = new Map<
    string,
    ReturnType<typeof projectItem>
  >();
  for (const item of timeline.activeBackgroundCommands) {
    if (!item.presentation?.suppress)
      items.set(item.id, projectItem(item, "command"));
  }
  for (const item of timeline.activeWorkflows) {
    if (item.presentation?.suppress) {
      items.delete(item.id);
      continue;
    }
    items.set(item.id, projectItem(item, "workflow"));
  }
  return { items: [...items.values()] };
}

export function createBackgroundJobsReadService(
  dependencies: BackgroundJobsDependencies,
) {
  return {
    async read(threadId: string) {
      const timeline = await dependencies.timeline({
        threadId,
        summaryOnly: "true",
        segmentLimit: "1",
      });
      return projectBackgroundJobs(timeline);
    },
  };
}
