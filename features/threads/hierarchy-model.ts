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
  | "hierarchy_not_fully_loaded"
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

export type ThreadHierarchyCandidate = HierarchyThread &
  Readonly<{
    rootThreadId: string;
    rootTitle: string;
  }>;

type RootResolution =
  | Readonly<{ state: "resolved"; rootThreadId: string }>
  | Readonly<{ state: "incomplete" }>
  | Readonly<{ state: "cyclic" }>;

function reject(
  code: HierarchyMoveRejectionCode,
  message: string,
  bindingTaskKey?: string,
): ThreadHierarchyMoveDecision {
  return bindingTaskKey
    ? { allowed: false, code, message, bindingTaskKey }
    : { allowed: false, code, message };
}

function hierarchyError(resolution: RootResolution): ThreadHierarchyMoveDecision | null {
  if (resolution.state === "resolved") return null;
  return resolution.state === "incomplete"
    ? reject(
        "hierarchy_not_fully_loaded",
        "The thread hierarchy is not fully loaded. Refresh the sidebar and try again.",
      )
    : reject(
        "invalid_hierarchy",
        "The thread hierarchy contains a cycle and cannot be changed.",
      );
}

/**
 * One per-sidebar ancestry index. Candidate derivation stays linear in the
 * roster instead of recomputing descendants and roots for every visible row.
 */
export function createThreadHierarchyIndex(
  threads: readonly HierarchyThread[],
  bindings: readonly HierarchyBinding[],
) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const childrenByParent = new Map<string, HierarchyThread[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    const children = childrenByParent.get(thread.parentThreadId) ?? [];
    children.push(thread);
    childrenByParent.set(thread.parentThreadId, children);
  }
  const roots = new Map<string, RootResolution>();
  const resolveRoot = (thread: HierarchyThread): RootResolution => {
    const cached = roots.get(thread.id);
    if (cached) return cached;
    const chain: HierarchyThread[] = [];
    const visited = new Set<string>();
    let current: HierarchyThread | undefined = thread;
    let result: RootResolution;
    while (current) {
      const known = roots.get(current.id);
      if (known) {
        result = known;
        break;
      }
      if (visited.has(current.id)) {
        result = { state: "cyclic" };
        break;
      }
      visited.add(current.id);
      chain.push(current);
      if (!current.parentThreadId) {
        result = { state: "resolved", rootThreadId: current.id };
        break;
      }
      current = byId.get(current.parentThreadId);
      if (!current) {
        result = { state: "incomplete" };
        break;
      }
    }
    // The loop only exits with a resolution; the fallback protects malformed
    // host data without turning it into an allowed hierarchy write.
    result ??= { state: "incomplete" };
    for (const item of chain) roots.set(item.id, result);
    return result;
  };
  const descendantsBySource = new Map<string, string[]>();
  const descendants = (sourceThreadId: string): string[] => {
    const cached = descendantsBySource.get(sourceThreadId);
    if (cached) return cached;
    const visited = new Set<string>();
    const queue = [sourceThreadId];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const child of childrenByParent.get(current) ?? []) queue.push(child.id);
    }
    const value = threads.flatMap((thread) =>
      visited.has(thread.id) ? [thread.id] : [],
    );
    descendantsBySource.set(sourceThreadId, value);
    return value;
  };
  const decide = (
    sourceThreadId: string,
    parentThreadId: string | null,
  ): ThreadHierarchyMoveDecision => {
    const source = byId.get(sourceThreadId);
    if (!source)
      return reject("source_missing", "The thread is no longer available.");
    const parent = parentThreadId ? (byId.get(parentThreadId) ?? null) : null;
    if (parentThreadId && !parent)
      return reject(
        "parent_missing",
        "The destination thread is no longer available.",
      );
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

    const affectedThreadIds = descendants(source.id);
    if (parent && affectedThreadIds.includes(parent.id))
      return reject(
        "descendant_cycle",
        "A thread cannot be moved under one of its descendants.",
      );

    const oldRoot = resolveRoot(source);
    if (oldRoot.state !== "resolved") return hierarchyError(oldRoot)!;
    const newRoot = parent
      ? resolveRoot(parent)
      : ({ state: "resolved", rootThreadId: source.id } as const);
    if (newRoot.state !== "resolved") return hierarchyError(newRoot)!;

    if (oldRoot.rootThreadId !== newRoot.rootThreadId) {
      const affected = new Set(affectedThreadIds);
      const invalidBinding = bindings.find(
        (binding) =>
          binding.rootThreadId === oldRoot.rootThreadId &&
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
      oldRootThreadId: oldRoot.rootThreadId,
      newRootThreadId: newRoot.rootThreadId,
      affectedThreadIds,
    };
  };
  const candidates = (sourceThreadId: string): ThreadHierarchyCandidate[] => {
    const source = byId.get(sourceThreadId);
    if (!source) return [];
    return threads
      .flatMap((thread) => {
        const decision = decide(sourceThreadId, thread.id);
        if (!decision.allowed) return [];
        const root = resolveRoot(thread);
        if (root.state !== "resolved") return [];
        return [
          {
            ...thread,
            rootThreadId: root.rootThreadId,
            rootTitle: byId.get(root.rootThreadId)?.title ?? "Unknown root",
          },
        ];
      })
      .sort(
        (left, right) =>
          Number(Boolean(left.parentThreadId)) - Number(Boolean(right.parentThreadId)) ||
          left.title.localeCompare(right.title),
      );
  };
  return { candidates, decide };
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
  return createThreadHierarchyIndex(threads, bindings).decide(
    sourceThreadId,
    parentThreadId,
  );
}

export function threadHierarchyCandidates(
  threads: readonly HierarchyThread[],
  bindings: readonly HierarchyBinding[],
  sourceThreadId: string,
): ThreadHierarchyCandidate[] {
  return createThreadHierarchyIndex(threads, bindings).candidates(sourceThreadId);
}
