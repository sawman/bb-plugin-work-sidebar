export const WORK_ITEM_QUEUE_KEY = "work-item-queue:v1";

type StoredReference = { source: "bb_task" | "linear"; id: string };
export type StoredWorkItemQueue = {
  current: StoredReference | null;
  backlog: StoredReference[];
};
export type PersistedWorkItemQueue = { configured: boolean; queue: StoredWorkItemQueue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeWorkItemQueue(value: unknown): StoredWorkItemQueue {
  if (!isRecord(value)) return { current: null, backlog: [] };
  const reference = (candidate: unknown): StoredReference | null =>
    isRecord(candidate) &&
    (candidate.source === "bb_task" || candidate.source === "linear") &&
    typeof candidate.id === "string" && candidate.id.trim()
      ? { source: candidate.source, id: candidate.id.trim() }
      : null;
  const current = reference(value.current);
  const seen = new Set(current ? [`${current.source}:${current.id.toUpperCase()}`] : []);
  const backlog = (Array.isArray(value.backlog) ? value.backlog : []).flatMap((candidate) => {
    const item = reference(candidate);
    const key = item && `${item.source}:${item.id.toUpperCase()}`;
    if (!item || !key || seen.has(key)) return [];
    seen.add(key);
    return [item];
  });
  return { current, backlog };
}

export function createWorkItemQueueService(dependencies: {
  get(): Promise<unknown>;
  set(value: Record<string, StoredWorkItemQueue>): Promise<void>;
  publish(rootThreadId: string): void;
  ensureOutcome(input: { rootThreadId: string; title: string; description: string }): unknown | Promise<unknown>;
  createExecution(input: { rootThreadId: string; title: string; description: string; idempotencyKey: string; assignee: "agent" }): { task: { id: string } } | Promise<{ task: { id: string } }>;
}) {
  const read = async (rootThreadId: string) => {
    const saved = await dependencies.get();
    const configured = isRecord(saved) && Object.prototype.hasOwnProperty.call(saved, rootThreadId);
    return {
      configured,
      queue: isRecord(saved) ? normalizeWorkItemQueue(saved[rootThreadId]) : { current: null, backlog: [] },
    };
  };
  const write = async (rootThreadId: string, queue: StoredWorkItemQueue) => {
    const saved = await dependencies.get();
    const rows: Record<string, StoredWorkItemQueue> = isRecord(saved)
      ? Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, normalizeWorkItemQueue(value)]))
      : {};
    await dependencies.set({ ...rows, [rootThreadId]: queue });
    dependencies.publish(rootThreadId);
    return { configured: true, queue };
  };
  const moveToExecution = async (rootThreadId: string, reference: StoredReference, title: string, description: string) => {
    const existing = (await read(rootThreadId)).queue;
    const matches = (item: StoredReference | null) => item?.source === reference.source && item.id.toUpperCase() === reference.id.toUpperCase();
    if (![existing.current, ...existing.backlog].some(matches)) throw new Error("This work item is not a current goal or backlog entry.");
    const remaining = existing.backlog.filter((item) => !matches(item));
    if (matches(existing.current) && remaining.length === 0) {
      throw new Error("Add a backlog goal before moving the current goal to tasks.");
    }
    await dependencies.ensureOutcome({ rootThreadId, title: `Outcome for ${title}`, description: "Created while moving a work goal into execution." });
    const execution = await dependencies.createExecution({
      rootThreadId,
      title,
      description: `${description}\n\nWork-item source: ${reference.source}:${reference.id}`.trim(),
      idempotencyKey: `work-item-execution:${reference.source}:${reference.id}`,
      assignee: "agent",
    });
    const next = matches(existing.current)
      ? { current: remaining[0] ?? null, backlog: remaining.slice(1) }
      : { current: existing.current, backlog: remaining };
    return { taskId: execution.task.id, ...(await write(rootThreadId, next)) };
  };
  return { read, write, moveToExecution };
}
