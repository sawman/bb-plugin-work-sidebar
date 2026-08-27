import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import { readGitHub } from "../../shared/github/read-cache.js";
import { classifyPullRequestError } from "./server.js";
import type { GitHubReadRunner } from "./server-types.js";

const execFileAsync = promisify(execFile);
export const GITHUB_READ_CACHE_MS = 2 * 60_000;

export type GitHubCommandService = {
  read: GitHubReadRunner;
  execute(args: readonly string[], maxBuffer: number): Promise<string>;
};

/** PR-owned command boundary: cached reads retain lifecycle generation semantics. */
export function createGitHubCommandService(lifecycle: ServerLifecycle): GitHubCommandService {
  const execute = async (args: readonly string[], maxBuffer: number) =>
    (await execFileAsync("gh", [...args], { maxBuffer })).stdout;
  return {
    execute,
    read: (args, maxBuffer, cacheTtlMs = GITHUB_READ_CACHE_MS) =>
      readGitHub(lifecycle, execute, classifyPullRequestError, args, maxBuffer, cacheTtlMs),
  };
}
