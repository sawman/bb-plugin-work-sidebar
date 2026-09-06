export type BranchDivergenceTarget = {
  threadId: string;
  environmentId: string;
  branchName: string;
};

export type BranchDivergence = {
  upstream: string;
  ahead: number;
  behind: number;
};

type BranchDivergenceDependencies = {
  diffBranches(input: {
    environmentId: string;
    query: string;
    selectedBranch: string;
    limit: string;
  }): Promise<{ remoteBranches: readonly string[] }>;
  status(input: {
    environmentId: string;
    mergeBaseBranch: string;
  }): Promise<
    | {
        outcome: "available";
        workspace: {
          mergeBase: {
            aheadCount: number;
            behindCount: number;
          } | null;
        };
      }
    | { outcome: string }
  >;
};

export const MAX_BRANCH_DIVERGENCE_CONCURRENCY = 6;

export function resolveRemoteTrackingBranch(
  branchName: string,
  remoteBranches: readonly string[],
) {
  const matches = remoteBranches.filter((remote) =>
    remote.endsWith(`/${branchName}`),
  );
  const origin = `origin/${branchName}`;
  if (matches.includes(origin)) return origin;
  return matches.length === 1 ? matches[0] ?? null : null;
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(items.length, MAX_BRANCH_DIVERGENCE_CONCURRENCY) },
      run,
    ),
  );
  return results;
}

export function createBranchDivergenceReader(
  dependencies: BranchDivergenceDependencies,
) {
  const compare = async (
    target: BranchDivergenceTarget,
    upstream: string,
  ): Promise<BranchDivergence | null> => {
    try {
      const status = await dependencies.status({
        environmentId: target.environmentId,
        mergeBaseBranch: upstream,
      });
      if (
        status.outcome !== "available" ||
        !("workspace" in status) ||
        !status.workspace.mergeBase
      ) return null;
      return {
        upstream,
        ahead: status.workspace.mergeBase.aheadCount,
        behind: status.workspace.mergeBase.behindCount,
      };
    } catch {
      return null;
    }
  };
  return async (targets: readonly BranchDivergenceTarget[]) => {
    const distinct = new Map<string, BranchDivergenceTarget>();
    for (const target of targets) {
      const key = `${target.environmentId}\0${target.branchName}`;
      if (!distinct.has(key)) distinct.set(key, target);
    }
    const values = await mapConcurrent([...distinct.entries()], async ([key, target]) => {
      try {
        const origin = await compare(target, `origin/${target.branchName}`);
        if (origin) return [key, origin] as const;
        const branches = await dependencies.diffBranches({
          environmentId: target.environmentId,
          query: target.branchName,
          selectedBranch: target.branchName,
          limit: "20",
        });
        const upstream = resolveRemoteTrackingBranch(
          target.branchName,
          branches.remoteBranches,
        );
        if (!upstream) return [key, null] as const;
        return [key, await compare(target, upstream)] as const;
      } catch {
        return [key, null] as const;
      }
    });
    const byEnvironment = new Map(values);
    return Object.fromEntries(
      targets.map((target) => [
        target.threadId,
        byEnvironment.get(`${target.environmentId}\0${target.branchName}`) ?? null,
      ]),
    ) as Record<string, BranchDivergence | null>;
  };
}
