import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { PullRequestChangesAdapter } from "../../shared/server-composition-dependencies.js";
import type { GitHubReadRunner } from "./server-types.js";
import { GITHUB_ACCEPT_HEADER, GITHUB_STACK_API_VERSION } from "./server-stack.js";

type PollingHandler = Pick<PluginRpcHandlers<typeof rpcContract>, "getGitHubPollingPolicy">;

export type GitHubPollingService = PollingHandler & Pick<PullRequestChangesAdapter, "fingerprint">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Owns user-configured PR polling cadence and the shared REST fingerprint budget. */
export function createGitHubPollingService(bb: BbPluginApi, read: GitHubReadRunner): GitHubPollingService {
  const settings = bb.settings.define({
    githubActivePollSeconds: { type: "select", label: "Right Work PR polling", description: "How often to poll the visible right-side Work PR through GitHub REST.", options: ["30", "60", "120", "300"], default: "60" },
    githubBackgroundPollSeconds: { type: "select", label: "Right Work PR background polling", description: "How often to poll the right-side Work PR while BB is not visible.", options: ["120", "300", "600", "900"], default: "300" },
    githubLeftListRefreshSeconds: { type: "select", label: "Left PR list refresh", description: "How often to refresh authored pull requests and Stack membership in the left sidebar.", options: ["60", "120", "300", "600"], default: "300" },
    githubMaxRestPollsPerMinute: { type: "select", label: "Global REST poll budget", description: "Maximum fingerprint polls across all Work panels each minute.", options: ["10", "20", "30", "60"], default: "30" },
  });
  let lastFingerprintPollAt = 0;
  const policy = async () => {
    const value = await settings.get();
    return {
      activePollMs: Number(value.githubActivePollSeconds) * 1_000,
      backgroundPollMs: Number(value.githubBackgroundPollSeconds) * 1_000,
      maxRestPollsPerMinute: Number(value.githubMaxRestPollsPerMinute),
    };
  };
  const fingerprint: PullRequestChangesAdapter["fingerprint"] = async (_threadId, url) => {
    const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return { fingerprint: null };
    const currentPolicy = await policy();
    if (Date.now() - lastFingerprintPollAt < 60_000 / currentPolicy.maxRestPollsPerMinute) return { fingerprint: null };
    lastFingerprintPollAt = Date.now();
    try {
      const value = JSON.parse(await read([
        "api", "--method", "GET", `repos/${match[1]}/${match[2]}/pulls/${match[3]}`,
        "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
        "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
      ], 2_000_000, 55_000)) as unknown;
      if (!isRecord(value)) return { fingerprint: null };
      return { fingerprint: JSON.stringify([value.updated_at, value.state, value.merged, value.draft, isRecord(value.head) ? value.head.sha : null, value.mergeable_state]) };
    } catch {
      return { fingerprint: null };
    }
  };
  return { getGitHubPollingPolicy: policy, fingerprint };
}
