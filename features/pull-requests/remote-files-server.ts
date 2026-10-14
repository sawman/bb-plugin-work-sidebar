import type { RemoteFiles, RemoteFilesInput } from "../changes/schemas.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { GitHubReadRunner } from "./server-types.js";
import { createRemoteCache } from "./remote-cache.js";
import { readGitHubPullRequestDiff } from "./server-stack.js";

export function repositoryFromUrl(url: string): string | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}
/** Only GitHub-derived file collections cross thread boundaries. No SDK handles. */
export function createRemoteFilesService(lifecycle: ServerLifecycle, read: GitHubReadRunner) {
  const cache = lifecycle.own(createRemoteCache<RemoteFiles["files"][number]>());
  lifecycle.onRemoteInvalidated((repository) => cache.invalidate(repository ? `${repository}:` : ""));
  async function loadPr(entry: RemoteFilesInput["pullRequests"][number]) {
    const repository = repositoryFromUrl(entry.url);
    if (!repository) throw new Error("Unsupported pull request URL.");
    const number = Number(entry.url.split("/").pop());
    const revision = lifecycle.remoteGeneration(repository);
    const key = `${repository}:${number}:${JSON.stringify([entry.head, entry.base])}`;
    return cache.read(key, async () => {
      const args = ["api", "--method", "GET", `repos/${repository}/pulls/${number}`];
      const metadata = async () => {
        const value = JSON.parse(await read(args, 2_000_000, 0)) as { head?: { sha?: string; ref?: string }; base?: { sha?: string; ref?: string } };
        if (!value.head?.sha || !value.base?.sha || value.head.ref !== entry.head || value.base.ref !== entry.base)
          throw new Error("Remote pull request identity changed. Refresh Changes.");
        return { headSha: value.head.sha, baseSha: value.base.sha };
      };
      const before = await metadata();
      const [owner, repo] = repository.split("/");
      const diff = await readGitHubPullRequestDiff(owner, repo, number, (args, buffer) => read(args, buffer, 0));
      const after = await metadata();
      if (before.headSha !== after.headSha || before.baseSha !== after.baseSha || lifecycle.remoteGeneration(repository) !== revision || lifecycle.isDisposed)
        throw new Error("Remote pull request identity changed during the read.");
      return { ...entry, url: `https://github.com/${repository}/pull/${number}`, ...after, diff };
    });
  }
  return {
    async files(input: RemoteFilesInput): Promise<RemoteFiles> {
      const files: RemoteFiles["files"] = [];
      for (let offset = 0; offset < input.pullRequests.length; offset += 8)
        files.push(...await Promise.all(input.pullRequests.slice(offset, offset + 8).map(loadPr)));
      return { files };
    },
    invalidate(repository: string | null) { cache.invalidate(repository ? `${repository.toLowerCase()}:` : ""); },
  };
}
