import { z } from "zod";
import type { RemoteFiles, RemoteFilesInput } from "../changes/schemas.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { GitHubReadRunner } from "./server-types.js";
import { createRemoteCache } from "./remote-cache.js";
import { readGitHubPullRequestDiff } from "./server-stack.js";

export const REMOTE_FILES_VALIDATION_MS = 120_000;
export const REMOTE_FILES_RETENTION_MS = 10 * 60_000;
const remoteHeadSchema = z.object({ sha: z.string().min(1), ref: z.string() });
export const remoteMetadataSchema = z.object({ head: remoteHeadSchema, base: remoteHeadSchema });
type FileSnapshot = { record: RemoteFiles["files"][number]; validatedAt: number };
export function repositoryFromUrl(url: string): string | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}
/** One bounded retained snapshot; only the validation deadline controls upstream reads. */
export function createRemoteFilesService(lifecycle: ServerLifecycle, read: GitHubReadRunner) {
  const cache = lifecycle.own(createRemoteCache<FileSnapshot>({ ttlMs: REMOTE_FILES_RETENTION_MS }));
  lifecycle.onRemoteInvalidated((repository) => cache.invalidate(repository ? `${repository}:` : ""));
  async function loadPr(entry: RemoteFilesInput["pullRequests"][number]) {
    const repository = repositoryFromUrl(entry.url);
    if (!repository) throw new Error("Unsupported pull request URL.");
    const number = Number(entry.url.split("/").pop());
    const revision = lifecycle.remoteGeneration(repository);
    const key = `${repository}:${number}:${JSON.stringify([entry.head, entry.base])}`;
    const previous = cache.peek(key);
    const result = await cache.read(key, async () => {
      const metadata = async () => {
        const raw = await read(["api", "--method", "GET", `repos/${repository}/pulls/${number}`], 2_000_000, 0);
        const value = remoteMetadataSchema.parse(JSON.parse(raw));
        if (value.head.ref !== entry.head || value.base.ref !== entry.base)
          throw new Error("Remote pull request identity changed. Refresh Changes.");
        return { headSha: value.head.sha, baseSha: value.base.sha };
      };
      const before = await metadata();
      let diff = previous?.record.headSha === before.headSha && previous.record.baseSha === before.baseSha
        ? previous.record.diff : null;
      if (!diff) {
        const [owner, repo] = repository.split("/");
        diff = await readGitHubPullRequestDiff(owner, repo, number, (args, buffer) => read(args, buffer, 0, JSON.stringify(before)));
        const after = await metadata();
        if (before.headSha !== after.headSha || before.baseSha !== after.baseSha)
          throw new Error("Remote pull request identity changed during the read.");
      }
      if (lifecycle.remoteGeneration(repository) !== revision || lifecycle.isDisposed)
        throw new Error("Remote pull request identity changed during the read.");
      return { record: { ...entry, url: `https://github.com/${repository}/pull/${number}`, ...before, diff }, validatedAt: Date.now() };
    }, () => true, { reuse: (snapshot) => Date.now() - snapshot.validatedAt < REMOTE_FILES_VALIDATION_MS });
    return result.record;
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
