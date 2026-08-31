type OwnerThread = Readonly<{
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  providerId: string;
  status: string;
  archivedAt: number | string | null;
}>;

type ExecutionBindingSummary = Readonly<{
  executionTaskId: string | null;
  ownerThreadId: string | null;
}>;

function liveStatus(status: string) {
  if (status === "active") return "working" as const;
  if (status === "starting") return "starting" as const;
  if (status === "completed") return "completed" as const;
  if (status === "failed") return "failed" as const;
  return "idle" as const;
}

/** Projects owner facts from the root's complete descendant roster. */
export function projectWorkBindingOwner<T extends ExecutionBindingSummary>(
  binding: T,
  threads: ReadonlyMap<string, OwnerThread>,
) {
  if (!binding.executionTaskId || !binding.ownerThreadId)
    return { ...binding, owner: null };
  const owner = threads.get(binding.ownerThreadId);
  return {
    ...binding,
    owner: owner ? {
      threadId: owner.id,
      title: owner.title ?? owner.titleFallback ?? "Untitled agent",
      providerId: owner.providerId,
      liveStatus: liveStatus(owner.status),
      isArchived: owner.archivedAt !== null,
    } : null,
  };
}
