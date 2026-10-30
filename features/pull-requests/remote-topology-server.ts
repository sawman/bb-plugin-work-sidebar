import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { GitHubReadRunner } from "./server-types.js";
import { createRemoteCache } from "./remote-cache.js";
import { githubStackApiArgs, githubStacksApiArgs, parseGitHubStacksResponse } from "./server-stack.js";
import { readObservedGitHub } from "./source-observation.js";

export type RemoteTopology = ReturnType<typeof parseGitHubStacksResponse>[number];
export type RepositoryTopologyReader = ReturnType<typeof createRepositoryTopologyReader>;

/** Shared discovery only: no author filter, local flags or computed review/check facts. */
export function createRepositoryTopologyReader(lifecycle: ServerLifecycle, read: GitHubReadRunner) {
  const cache = lifecycle.own(createRemoteCache<RemoteTopology[]>());
  lifecycle.onRemoteInvalidated((repository) => cache.invalidate(repository ? `${repository}:` : ""));
  const repositoryKey = (owner: string, repo: string) => `${owner}/${repo}`.toLowerCase();
  async function discover(repository: string, key: string, args: string[]) {
    let deadline = Infinity;
    const generation = lifecycle.remoteGeneration(repository);
    return cache.read(key, async () => {
      const source = await readObservedGitHub((commandArgs, buffer, policy) => read(commandArgs, buffer, undefined, undefined, policy), args, 12_000_000);
      deadline = lifecycle.githubReadCache.get(args.join("\u0000"))?.expiresAt ?? Infinity;
      const parsed = parseGitHubStacksResponse(JSON.parse(source.text)).map((stack) => ({ ...stack, pullRequests: stack.pullRequests.map((member) => {
        return { ...member, observations: Object.fromEntries(Object.entries(member.observations ?? {}).map(([group, clock]) => [group,
          { ...clock, validatedAt: source.validatedAt, ...(source.sequence === undefined ? {} : { sequence: source.sequence }), epoch: lifecycle.observationEpoch }])) };
      }) }));
      if (lifecycle.isDisposed || lifecycle.remoteGeneration(repository) !== generation)
        throw new Error("Remote topology changed during discovery.");
      return parsed;
    }, () => lifecycle.githubRestHealth.state === "available", {
      expiresAt: () => Math.min(Date.now() + 30_000, deadline),
    });
  }
  async function repository(owner: string, repo: string) {
    const scope = repositoryKey(owner, repo);
    const roster = await discover(scope, `${scope}:roster`, githubStacksApiArgs(owner.toLowerCase(), repo.toLowerCase()));
    // Repository-list completeness is not assumed. Retain independently
    // confirmed stacks without discarding any members from the list response.
    const combined = new Map(roster.map((stack) => [stack.number, stack]));
    for (const snapshots of cache.select(`${scope}:member:`))
      for (const stack of snapshots) if (!combined.has(stack.number)) combined.set(stack.number, stack);
    return [...combined.values()];
  }
  async function member(owner: string, repo: string, number: number, head: string, base: string) {
    const scope = repositoryKey(owner, repo);
    const matches = (stack: RemoteTopology) => stack.pullRequests.some((entry) => entry.number === number && (!entry.head || entry.head === head) && (!entry.base || entry.base === base));
    const roster = await repository(owner, repo);
    const known = roster.find(matches);
    if (known) return known;
    // A listing may omit an older/closed/recent stack. Preserve the previous
    // targeted endpoint as one bounded fallback for the confirmed thread PR.
    const snapshots = await discover(scope, `${scope}:member:${JSON.stringify([number, head, base])}`, githubStackApiArgs(owner.toLowerCase(), repo.toLowerCase(), number));
    return snapshots.find(matches) ?? null;
  }
  return { repository, member, invalidate(repository: string | null) { cache.invalidate(repository ? `${repository.toLowerCase()}:` : ""); } };
}
