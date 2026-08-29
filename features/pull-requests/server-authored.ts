import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import { clearGitHubReadCache, githubReadHealth } from "../../shared/github/read-cache.js";
import type { GitHubCommandService } from "./server-github-read.js";
import { createPullRequestService } from "./server.js";
import {
  githubStacksApiArgs,
  parseGitHubStacksResponse,
  readGitHubSignals,
} from "./server-stack.js";
import type { AuthoredPullRequest, GitHubReadRunner, GitHubSignal } from "./server-types.js";
import { createPullRequestReviewerService } from "./server-reviewers.js";

const GITHUB_SEARCH_CACHE_MS = 5 * 60_000;

type AuthoredHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getGitHubApiHealth"
  | "sidebarAuthoredPullRequests"
  | "sidebarAuthoredPullRequestStacks"
  | "setAuthoredPullRequestDraft"
  | "getPullRequestReviewers"
  | "updatePullRequestReviewers"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createArchiveLookup(read: GitHubReadRunner) {
  return async (repositories: readonly string[]) => {
    const unique = [...new Set(repositories)].filter((repository) => /^[^/]+\/[^/]+$/.test(repository));
    const archived = new Set<string>();
    for (let start = 0; start < unique.length; start += 50) {
      const batch = unique.slice(start, start + 50);
      const selections = batch.map((repository, index) => {
        const slash = repository.indexOf("/");
        return `r${index}: repository(owner: ${JSON.stringify(repository.slice(0, slash))}, name: ${JSON.stringify(repository.slice(slash + 1))}) { isArchived }`;
      }).join(" ");
      try {
        const value = JSON.parse(await read(["api", "graphql", "-f", `query=query { ${selections} }`], 2_000_000)) as unknown;
        const data: Record<string, unknown> = isRecord(value) && isRecord(value.data) ? value.data : {};
        batch.forEach((repository, index) => {
          const result = data[`r${index}`];
          if (isRecord(result) && result.isArchived === true) archived.add(repository);
        });
      } catch {
        // A transient archive lookup must not hide an otherwise valid PR.
      }
    }
    return archived;
  };
}

function createAuthoredReader(lifecycle: ServerLifecycle, read: GitHubReadRunner) {
  return async (): Promise<AuthoredPullRequest[]> => {
    const value = JSON.parse(await read(["search", "prs", "--author", "@me", "--state", "open", "--limit", "1000", "--json", "number,title,url,repository,state,isDraft"], 12_000_000, GITHUB_SEARCH_CACHE_MS)) as unknown;
    if (!Array.isArray(value)) throw new Error("GitHub returned an invalid authored pull request list");
    const base = value.flatMap((entry): AuthoredPullRequest[] => {
      if (!isRecord(entry) || typeof entry.number !== "number" || typeof entry.title !== "string" || typeof entry.url !== "string" || !isRecord(entry.repository) || typeof entry.repository.nameWithOwner !== "string") return [];
      return [{
        number: entry.number, title: entry.title, url: entry.url, repository: entry.repository.nameWithOwner,
        state: entry.isDraft === true ? "draft" : "open", draft: entry.isDraft === true,
        head: "", base: "", checks: "unknown", review: "none", reviewCommentCount: 0, stack: null,
      }];
    });
    const signals = new Map<string, GitHubSignal>();
    const groups = new Map<string, number[]>();
    for (const item of base) {
      const numbers = groups.get(item.repository) ?? [];
      numbers.push(item.number);
      groups.set(item.repository, numbers);
    }
    for (const [repository, numbers] of groups) {
      const [owner, repo] = repository.split("/", 2);
      if (!owner || !repo) continue;
      for (const [number, signal] of await readGitHubSignals(owner, repo, numbers, lifecycle, (args, buffer) => read(args, buffer))) {
        signals.set(`${repository}#${number}`, signal);
      }
    }
    return base.map((item) => ({ ...item, ...(signals.get(`${item.repository}#${item.number}`) ?? {}) }));
  };
}

function createAuthoredStackReader(read: GitHubReadRunner) {
  return async (base: AuthoredPullRequest[]): Promise<AuthoredPullRequest[]> => {
    const byPullRequest = new Map(base.map((item) => [`${item.repository}#${item.number}`, item]));
    const byRepository = new Map<string, AuthoredPullRequest[]>();
    for (const item of base) {
      const items = byRepository.get(item.repository) ?? [];
      items.push(item);
      byRepository.set(item.repository, items);
    }
    const enriched = new Map<string, AuthoredPullRequest>();
    const failures: unknown[] = [];
    const describeRepository = async (
      repository: string,
      authoredItems: readonly AuthoredPullRequest[],
    ): Promise<void> => {
      const [owner, repo] = repository.split("/", 2);
      if (!owner || !repo) return;
      const authoredNumbers = new Set(
        authoredItems.map((item) => item.number),
      );
      try {
        const stacks = parseGitHubStacksResponse(
          JSON.parse(
            await read(githubStacksApiArgs(owner, repo), 12_000_000),
          ) as unknown,
        );
        for (const stack of stacks) {
          const pullRequests = stack.pullRequests.flatMap((layer) => {
            const known = byPullRequest.get(`${repository}#${layer.number}`);
            return known
              ? [
                  {
                    ...known,
                    head: layer.head,
                    base: layer.base || stack.base,
                  },
                ]
              : [];
          });
          if (pullRequests.length === 0) continue;
          for (const item of pullRequests) {
            if (!authoredNumbers.has(item.number)) continue;
            enriched.set(`${repository}#${item.number}`, {
              ...item,
              stack: {
                id: `github-stack:${repository}:${stack.number}`,
                number: stack.number,
                base: stack.base,
                currentPullRequest: item.number,
                pullRequests,
              },
            });
          }
        }
      } catch (error) {
        failures.push(error);
      }
    };
    const repositories = [...byRepository.entries()];
    for (let start = 0; start < repositories.length; start += 4) {
      await Promise.all(
        repositories
          .slice(start, start + 4)
          .map(([repository, items]) =>
            describeRepository(repository, items),
          ),
      );
    }
    if (failures.length > 0) throw failures[0];
    return base.map(
      (item) => enriched.get(`${item.repository}#${item.number}`) ?? item,
    );
  };
}

/** Owns authored-list cache disposal, archive filtering, and draft mutation. */
export function createAuthoredPullRequestService(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
  commands: GitHubCommandService,
): AuthoredHandlers {
  const archivedRepositories = createArchiveLookup(commands.read);
  const authored = createPullRequestService<AuthoredPullRequest>({
    now: () => Date.now(),
    readAuthored: createAuthoredReader(lifecycle, commands.read),
    readStacks: createAuthoredStackReader(commands.read),
    archivedRepositories: async (items) => archivedRepositories(items.map((item) => item.repository)),
    setDraft: async (url, draft) => {
      await commands.execute(["pr", "ready", url, ...(draft ? ["--undo"] : [])], 1_000_000);
      clearGitHubReadCache(lifecycle);
      return { draft };
    },
  });
  const reviewers = createPullRequestReviewerService(
    lifecycle,
    commands,
    () => authored.clear(),
  );
  bb.onDispose(() => authored.dispose());
  return {
    async getGitHubApiHealth() { return githubReadHealth(lifecycle); },
    async sidebarAuthoredPullRequests({ force }) {
      try {
        if (force) { authored.clear(); clearGitHubReadCache(lifecycle); }
        return { available: true, pullRequests: await authored.authored(), error: null };
      } catch (error) {
        return { available: false, pullRequests: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarAuthoredPullRequestStacks() {
      try { return { available: true, pullRequests: await authored.stacks(), error: null }; }
      catch (error) { return { available: false, pullRequests: [], error: error instanceof Error ? error.message : String(error) }; }
    },
    async setAuthoredPullRequestDraft({ url, draft }) { return authored.setDraft(url, draft); },
    async getPullRequestReviewers({ repository, force }) {
      try {
        return {
          available: true,
          reviewers: await reviewers.list(repository, force),
          error: null,
        };
      } catch (error) {
        return {
          available: false,
          reviewers: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async updatePullRequestReviewers({ repository, number, reviewers: desired }) {
      return { reviewers: await reviewers.update(repository, number, desired) };
    },
  };
}
