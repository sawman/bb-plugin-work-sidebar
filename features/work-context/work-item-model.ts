import type { TaskSummary } from "../../work-model";
import type { TrackerContext } from "../tracker/schemas";

export type WorkItemTrackerRecord = Readonly<
  TrackerContext["items"][number]["item"] & {
    statusOptions: TrackerContext["items"][number]["statusOptions"];
  }
>;

/**
 * A durable queue stores identity and lane only. Presentation remains sourced
 * from BB Tasks or Taskboard at read time, so a stale queue cannot overwrite
 * a source record's title or status.
 */
export type WorkItemReference = Readonly<{
  source: "bb_task" | "linear";
  id: string;
}>;

export type WorkItemQueue = Readonly<{
  current: WorkItemReference | null;
  backlog: readonly WorkItemReference[];
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
  queue?: WorkItemQueue | null;
}>;

function sameReference(left: WorkItemReference, right: WorkItemReference) {
  return left.source === right.source && left.id.toUpperCase() === right.id.toUpperCase();
}

function distinctReferences(items: readonly WorkItemReference[]) {
  return items.filter((item, index) =>
    items.findIndex((candidate) => sameReference(candidate, item)) === index,
  );
}

/**
 * Migrates the old canonical-outcome/primary-Linear presentation into the
 * explicit queue. An explicit queue always wins, including an empty one.
 */
export function resolveWorkItemQueue({
  outcome,
  linked,
  primaryLinearKey,
  queue,
}: Pick<WorkItemInput, "outcome" | "linked" | "primaryLinearKey" | "queue">): WorkItemQueue {
  if (queue) {
    const current = queue.current;
    const backlog = distinctReferences(queue.backlog).filter(
      (item) => !current || !sameReference(item, current),
    );
    return { current, backlog };
  }
  const linear = linked.map((item) => ({ source: "linear" as const, id: item.key }));
  const primary = linked.find((item) => item.key === primaryLinearKey) ?? linked[0] ?? null;
  if (outcome)
    return {
      current: { source: "bb_task", id: outcome.id },
      backlog: linear,
    };
  if (!primary) return { current: null, backlog: [] };
  const current = { source: "linear" as const, id: primary.key };
  return { current, backlog: linear.filter((item) => !sameReference(item, current)) };
}

export function promoteWorkItem(queue: WorkItemQueue, reference: WorkItemReference): WorkItemQueue {
  if (queue.current && sameReference(queue.current, reference)) return queue;
  return {
    current: reference,
    backlog: distinctReferences([
      ...(queue.current ? [queue.current] : []),
      ...queue.backlog.filter((item) => !sameReference(item, reference)),
    ]),
  };
}

/** Removes a goal from the queue; the first remaining backlog goal becomes Current. */
export function moveWorkItemToTasks(
  queue: WorkItemQueue,
  reference: WorkItemReference,
): WorkItemQueue {
  const withoutCurrent = queue.current && sameReference(queue.current, reference)
    ? null
    : queue.current;
  const backlog = queue.backlog.filter((item) => !sameReference(item, reference));
  if (withoutCurrent) return { current: withoutCurrent, backlog };
  const [next, ...rest] = backlog;
  return { current: next ?? null, backlog: rest };
}

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
  queue,
}: WorkItemInput) {
  const workQueue = resolveWorkItemQueue({ outcome, linked, primaryLinearKey, queue });
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
    queue: workQueue,
  };
}
