export type HierarchyThread = Readonly<{
  id: string;
  projectId: string;
  parentThreadId: string | null;
  isArchived: boolean;
  title: string;
}>;

export type HierarchyBinding = Readonly<{
  kind: "outcome" | "execution";
  rootThreadId: string;
  ownerThreadId: string;
  taskKey: string;
}>;

type HierarchyMoveInput = Readonly<{
  threads: readonly HierarchyThread[];
  bindings: readonly HierarchyBinding[];
  sourceThreadId: string;
  parentThreadId: string | null;
}>;

type HierarchyMoveRejectionCode =
  | "archived_thread"
  | "binding_root_change"
  | "cross_project"
  | "descendant_cycle"
  | "invalid_hierarchy"
  | "parent_missing"
  | "same_parent"
  | "same_thread"
  | "source_missing";

export type ThreadHierarchyMoveDecision =
  | Readonly<{
      allowed: true;
      source: HierarchyThread;
      parent: HierarchyThread | null;
      oldRootThreadId: string;
      newRootThreadId: string;
      affectedThreadIds: string[];
    }>
  | Readonly<{
      allowed: false;
      code: HierarchyMoveRejectionCode;
      message: string;
      bindingTaskKey?: string;
    }>;

function reject(
  code: HierarchyMoveRejectionCode,
  message: string,
  bindingTaskKey?: string,
): ThreadHierarchyMoveDecision {
  return bindingTaskKey
    ? { allowed: false, code, message, bindingTaskKey }
    : { allowed: false, code, message };
}

function rootThreadId(
  byId: ReadonlyMap<string, HierarchyThread>,
  thread: HierarchyThread,
): string | null {
  const visited = new Set<string>();
  let current = thread;
  while (current.parentThreadId) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = byId.get(current.parentThreadId);
    if (!parent) return null;
    current = parent;
  }
  return current.id;
}

function descendantIds(
  threads: readonly HierarchyThread[],
  sourceThreadId: string,
): string[] {
  const descendants = new Set([sourceThreadId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of threads) {
      if (
        thread.parentThreadId &&
        descendants.has(thread.parentThreadId) &&
        !descendants.has(thread.id)
      ) {
        descendants.add(thread.id);
        changed = true;
      }
    }
  }
  return threads.flatMap((thread) =>
    descendants.has(thread.id) ? [thread.id] : [],
  );
}

/**
 * Evaluates a host hierarchy write without mutating BB state. Durable Work
 * bindings may survive moves inside one root, but never an implicit root move.
 */
export function evaluateThreadHierarchyMove({
  threads,
  bindings,
  sourceThreadId,
  parentThreadId,
}: HierarchyMoveInput): ThreadHierarchyMoveDecision {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const source = byId.get(sourceThreadId);
  if (!source)
    return reject("source_missing", "The thread is no longer available.");
  const parent = parentThreadId ? (byId.get(parentThreadId) ?? null) : null;
  if (parentThreadId && !parent)
    return reject("parent_missing", "The destination thread is no longer available.");
  if (source.id === parentThreadId)
    return reject("same_thread", "A thread cannot be its own parent.");
  if (source.isArchived || parent?.isArchived)
    return reject(
      "archived_thread",
      "Unarchive the thread before changing its hierarchy.",
    );
  if (source.parentThreadId === parentThreadId)
    return reject("same_parent", "The thread is already in that position.");
  if (parent && source.projectId !== parent.projectId)
    return reject(
      "cross_project",
      "Threads can only be moved within the same project.",
    );

  const affectedThreadIds = descendantIds(threads, source.id);
  if (parent && affectedThreadIds.includes(parent.id))
    return reject(
      "descendant_cycle",
      "A thread cannot be moved under one of its descendants.",
    );

  const oldRootThreadId = rootThreadId(byId, source);
  const newRootThreadId = parent ? rootThreadId(byId, parent) : source.id;
  if (!oldRootThreadId || !newRootThreadId)
    return reject(
      "invalid_hierarchy",
      "The current thread hierarchy is incomplete or cyclic.",
    );

  if (oldRootThreadId !== newRootThreadId) {
    const affected = new Set(affectedThreadIds);
    const invalidBinding = bindings.find(
      (binding) =>
        binding.rootThreadId === oldRootThreadId &&
        affected.has(binding.ownerThreadId),
    );
    if (invalidBinding)
      return reject(
        "binding_root_change",
        `${invalidBinding.taskKey} owns durable work in the current root. Complete, cancel, or explicitly rebind that work before moving this thread.`,
        invalidBinding.taskKey,
      );
  }

  return {
    allowed: true,
    source,
    parent,
    oldRootThreadId,
    newRootThreadId,
    affectedThreadIds,
  };
}

export function threadHierarchyCandidates(
  threads: readonly HierarchyThread[],
  bindings: readonly HierarchyBinding[],
  sourceThreadId: string,
): HierarchyThread[] {
  return threads.filter((thread) =>
    evaluateThreadHierarchyMove({
      threads,
      bindings,
      sourceThreadId,
      parentThreadId: thread.id,
    }).allowed,
  );
}
