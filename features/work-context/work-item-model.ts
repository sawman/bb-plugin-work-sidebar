import type { TaskSummary } from "../../work-model";

export type WorkItemTrackerRecord = Readonly<{
  key: string;
  title: string;
  url: string;
  status: string;
  stateCategory: "backlog" | "todo" | "in_progress" | "done" | "canceled";
  priority: string | null;
  assignee: string | null;
  project: string | null;
  statusOptions: readonly Readonly<{
    id: string;
    name: string;
    current: boolean;
  }>[];
}>;

type WorkItemState =
  | "empty"
  | "external_only"
  | "legacy_adoptable"
  | "managed";

type WorkItemInput = Readonly<{
  outcome: TaskSummary | null;
  linked: readonly WorkItemTrackerRecord[];
  primaryLinearKey: string | null;
  legacyState: "none" | "adoptable" | "ambiguous" | "project_mismatch";
}>;

function taskPriority(priority: string | null): TaskSummary["priority"] {
  switch (priority?.trim().toLocaleLowerCase()) {
    case "urgent":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "none";
  }
}

/** Pure composition; BB Tasks and Linear remain independently owned records. */
export function projectWorkItem({
  outcome,
  linked,
  primaryLinearKey,
  legacyState,
}: WorkItemInput) {
  const primary =
    linked.find((record) => record.key === primaryLinearKey) ?? linked[0] ?? null;
  const ordered = primary
    ? [primary, ...linked.filter((record) => record.key !== primary.key)]
    : [];
  const state: WorkItemState = outcome
    ? "managed"
    : ordered.length
      ? "external_only"
      : legacyState === "adoptable"
        ? "legacy_adoptable"
        : "empty";
  return {
    state,
    outcome,
    linked: ordered,
    primaryLinearKey: primary?.key ?? null,
    createFromLinear:
      !outcome && primary
        ? {
            key: primary.key,
            title: primary.title,
            priority: taskPriority(primary.priority),
          }
        : null,
  };
}
