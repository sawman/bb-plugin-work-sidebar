import type { ThreadProvider } from "../../components/threads/thread-provider-logo";

export type PullRequestThreadReference = {
  id: string;
  title: string;
  branchName: string | null;
  providerId: string;
  provider?: ThreadProvider;
  parentThreadId?: string | null;
};

/**
 * Prefer the one top-level owner when child workers share its branch. Truly
 * ambiguous branches with multiple roots still produce no association.
 */
export function uniqueThreadsByBranch(
  threads: readonly PullRequestThreadReference[],
): ReadonlyMap<string, PullRequestThreadReference> {
  const candidates = new Map<string, PullRequestThreadReference[]>();
  for (const thread of threads) {
    const branch = thread.branchName?.trim();
    if (!branch) continue;
    const branchThreads = candidates.get(branch) ?? [];
    branchThreads.push(thread);
    candidates.set(branch, branchThreads);
  }
  const unique = new Map<string, PullRequestThreadReference>();
  for (const [branch, branchThreads] of candidates) {
    if (branchThreads.length === 1) {
      unique.set(branch, branchThreads[0]!);
      continue;
    }
    const roots = branchThreads.filter(
      (thread) => thread.parentThreadId == null,
    );
    if (roots.length === 1) unique.set(branch, roots[0]!);
  }
  return unique;
}

/**
 * A stack has one thread affordance even when the checked-out branch belongs
 * to a lower layer. Resolve in visual stack order so the top PR row can own
 * that affordance without duplicating it on an expanded child row.
 */
export function linkedThreadForStack(
  layers: readonly { head: string }[],
  threadsByBranch: ReadonlyMap<string, PullRequestThreadReference>,
): PullRequestThreadReference | undefined {
  for (const layer of layers) {
    const thread = threadsByBranch.get(layer.head);
    if (thread) return thread;
  }
  return undefined;
}
