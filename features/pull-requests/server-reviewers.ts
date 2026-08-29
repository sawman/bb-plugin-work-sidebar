import type { ServerLifecycle } from "../../server-lifecycle.js";
import { clearGitHubReadCache } from "../../shared/github/read-cache.js";
import type { GitHubCommandService } from "./server-github-read.js";

export const REVIEWER_DIRECTORY_CACHE_MS = 24 * 60 * 60_000;

export type PullRequestReviewer = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueLogins(logins: readonly string[]): string[] {
  const byLogin = new Map<string, string>();
  for (const login of logins) {
    const trimmed = login.trim();
    if (trimmed && !byLogin.has(trimmed.toLocaleLowerCase()))
      byLogin.set(trimmed.toLocaleLowerCase(), trimmed);
  }
  return [...byLogin.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

export function parseReviewerDirectory(value: unknown): PullRequestReviewer[] {
  if (!Array.isArray(value)) return [];
  const entries = value.flatMap((page) =>
    Array.isArray(page) ? page : [page],
  );
  const reviewers = new Map<string, PullRequestReviewer>();
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      typeof entry.login !== "string" ||
      !isRecord(entry.permissions) ||
      entry.permissions.push !== true
    )
      continue;
    const key = entry.login.toLocaleLowerCase();
    if (reviewers.has(key)) continue;
    reviewers.set(key, {
      login: entry.login,
      name: typeof entry.name === "string" ? entry.name : null,
      avatarUrl: typeof entry.avatar_url === "string" ? entry.avatar_url : null,
    });
  }
  return [...reviewers.values()].sort((left, right) =>
    left.login.localeCompare(right.login, undefined, { sensitivity: "base" }),
  );
}

function parseRequestedReviewers(value: unknown): {
  users: string[];
  teams: string[];
} {
  if (!isRecord(value) || !Array.isArray(value.users))
    throw new Error("GitHub returned an invalid requested-reviewer list");
  return {
    users: uniqueLogins(
      value.users.flatMap((user) =>
        isRecord(user) && typeof user.login === "string" ? [user.login] : [],
      ),
    ),
    teams: uniqueLogins(
      Array.isArray(value.teams)
        ? value.teams.flatMap((team) =>
            isRecord(team) && typeof team.slug === "string" ? [team.slug] : [],
          )
        : [],
    ),
  };
}

/** Server-owned reviewer directory and requested-review mutation boundary. */
export function createPullRequestReviewerService(
  lifecycle: ServerLifecycle,
  commands: GitHubCommandService,
  onChanged: () => void = () => undefined,
) {
  const assertActive = () => {
    if (lifecycle.isDisposed)
      throw new Error("GitHub reviewer lifecycle is disposed.");
  };
  return {
    async list(
      repository: string,
      force = false,
    ): Promise<PullRequestReviewer[]> {
      assertActive();
      if (force) clearGitHubReadCache(lifecycle);
      const output = await commands.read(
        [
          "api",
          "--method",
          "GET",
          `repos/${repository}/collaborators?affiliation=all&per_page=100`,
          "--paginate",
          "--slurp",
        ],
        4_000_000,
        REVIEWER_DIRECTORY_CACHE_MS,
      );
      return parseReviewerDirectory(JSON.parse(output) as unknown);
    },

    async update(
      repository: string,
      number: number,
      desiredLogins: readonly string[],
    ): Promise<string[]> {
      assertActive();
      const endpoint = `repos/${repository}/pulls/${number}/requested_reviewers`;
      const current = parseRequestedReviewers(
        JSON.parse(
          await commands.execute(
            ["api", "--method", "GET", endpoint],
            2_000_000,
          ),
        ) as unknown,
      );
      const desired = uniqueLogins(desiredLogins);
      const currentUserKeys = new Set(
        current.users.map((login) => login.toLocaleLowerCase()),
      );
      const currentTeamKeys = new Set(
        current.teams.map((login) => login.toLocaleLowerCase()),
      );
      const desiredKeys = new Set(
        desired.map((login) => login.toLocaleLowerCase()),
      );
      const additions = desired.filter((login) => {
        const key = login.toLocaleLowerCase();
        return !currentUserKeys.has(key) && !currentTeamKeys.has(key);
      });
      const userRemovals = current.users.filter(
        (login) => !desiredKeys.has(login.toLocaleLowerCase()),
      );
      const teamRemovals = current.teams.filter(
        (login) => !desiredKeys.has(login.toLocaleLowerCase()),
      );
      if (!additions.length && !userRemovals.length && !teamRemovals.length)
        return desired;

      let attemptedMutation = false;
      try {
        if (additions.length) {
          assertActive();
          attemptedMutation = true;
          await commands.execute(
            [
              "api",
              "--method",
              "POST",
              endpoint,
              ...additions.flatMap((login) => [
                "--field",
                `reviewers[]=${login}`,
              ]),
            ],
            2_000_000,
          );
        }
        if (userRemovals.length || teamRemovals.length) {
          assertActive();
          attemptedMutation = true;
          await commands.execute(
            [
              "api",
              "--method",
              "DELETE",
              endpoint,
              ...userRemovals.flatMap((login) => [
                "--field",
                `reviewers[]=${login}`,
              ]),
              ...teamRemovals.flatMap((login) => [
                "--field",
                `team_reviewers[]=${login}`,
              ]),
            ],
            2_000_000,
          );
        }
        return desired;
      } finally {
        if (attemptedMutation && !lifecycle.isDisposed) {
          clearGitHubReadCache(lifecycle);
          onChanged();
        }
      }
    },
  };
}
