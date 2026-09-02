import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SidebarListActions } from "@/components/ui/sidebar-list-actions";
import { SidebarTable } from "@/components/ui/sidebar-table";
import { SidebarSearch } from "@/components/ui/sidebar-search";
import {
  AuthoredPullRequestRow,
  AuthoredPullRequestStack,
  type AuthoredPullRequest,
} from "./authored-pull-requests";
import type { rpcContract } from "../../contracts";
import type { SidebarStack } from "../../work-model";
import { githubHealthPresentation } from "./presentation";
import {
  useAuthoredPullRequests,
  useGitHubApiHealth,
  useSetAuthoredPullRequestDraft,
} from "./queries";
import {
  uniqueThreadsByBranch,
  type PullRequestThreadReference,
} from "./thread-link";

const EMPTY_PULL_REQUESTS: AuthoredPullRequest[] = [];
const EMPTY_THREADS_BY_BRANCH = new Map<string, PullRequestThreadReference>();
const EMPTY_GROUPS: {
  repository: string;
  stacks: SidebarStack[];
  ordinary: AuthoredPullRequest[];
}[] = [];

export interface PullRequestsLeftSidebarProps {
  active: boolean;
  searchQuery: string;
  threads: readonly PullRequestThreadReference[];
  onOpenThread(threadId: string): void;
  settingsControl: ReactNode;
}

/** The Pull Requests slice owns authored-PR loading, drafting, grouping and selection. */
export function PullRequestsLeftSidebar({
  active,
  searchQuery,
  threads,
  onOpenThread,
  settingsControl,
}: PullRequestsLeftSidebarProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const { values: settings } = useSettings();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const effectiveSearchQuery = localSearchQuery || searchQuery;
  // Left sidebar tabs intentionally warm independently so opening PRs can use
  // the shared authored cache immediately instead of starting a cold fetch.
  const list = useAuthoredPullRequests(rpc, {
    intervalMs: Number(settings?.githubLeftListRefreshSeconds ?? "300") * 1_000,
  });
  const draft = useSetAuthoredPullRequestDraft(rpc);
  const healthQuery = useGitHubApiHealth(rpc, {
    poll: active,
    enabled: active,
  });
  const pullRequests = (list.data ??
    EMPTY_PULL_REQUESTS) as AuthoredPullRequest[];
  const threadsByBranch = useMemo(
    () => (active ? uniqueThreadsByBranch(threads) : EMPTY_THREADS_BY_BRANCH),
    [active, threads],
  );
  const visible = useMemo(
    () =>
      active
        ? pullRequests.filter((pullRequest) => {
            const needle = effectiveSearchQuery.trim().toLocaleLowerCase();
            return (
              !needle ||
              [
                pullRequest.repository,
                `#${pullRequest.number}`,
                pullRequest.title,
                pullRequest.head,
                pullRequest.base,
                pullRequest.state,
              ]
                .join(" ")
                .toLocaleLowerCase()
                .includes(needle)
            );
          })
        : EMPTY_PULL_REQUESTS,
    [active, effectiveSearchQuery, pullRequests],
  );
  const groups = useMemo(() => {
    if (!active) return EMPTY_GROUPS;
    const result = new Map<
      string,
      {
        repository: string;
        stacks: Map<string, SidebarStack>;
        ordinary: AuthoredPullRequest[];
      }
    >();
    for (const pullRequest of visible) {
      const group = result.get(pullRequest.repository) ?? {
        repository: pullRequest.repository,
        stacks: new Map<string, SidebarStack>(),
        ordinary: [],
      };
      if (pullRequest.stack)
        group.stacks.set(pullRequest.stack.id, pullRequest.stack);
      else group.ordinary.push(pullRequest);
      result.set(pullRequest.repository, group);
    }
    return [...result.values()].map((group) => ({
      ...group,
      stacks: [...group.stacks.values()],
    }));
  }, [active, visible]);
  const toggleDraft = useCallback(
    (pullRequest: Omit<AuthoredPullRequest, "stack">) => {
      draft.mutate(
        { url: pullRequest.url, draft: !pullRequest.draft },
        {
          onError: (cause: unknown) =>
            toast.error(
              cause instanceof Error
                ? cause.message
                : "Could not update pull request state",
            ),
        },
      );
    },
    [draft],
  );
  const healthState = healthQuery.data ?? {
    state: "available" as const,
    scope: "unknown" as const,
    message: null,
    retryAt: null,
  };
  const health = githubHealthPresentation(healthState);
  const changingDraftUrl = draft.isPending
    ? (draft.variables?.url ?? null)
    : null;

  if (!active) return null;
  return (
    <>
      <div className="ws-list-toolbar">
        <span>
          {visible.length} open PR{visible.length === 1 ? "" : "s"}
        </span>
        <SidebarListActions
          context={
            health ? (
              <ActionTooltip label={health.detail}>
                {(tooltipId) => <span
                className={`ws-github-api-indicator ws-github-api-${health.tone}`}
                aria-describedby={tooltipId}
                >
                <Icon name={health.icon} aria-hidden />
                {health.label}
                </span>}
              </ActionTooltip>
            ) : undefined
          }
          search={
            <SidebarSearch
              label="pull requests"
              value={localSearchQuery}
              onValueChange={setLocalSearchQuery}
            />
          }
          settings={settingsControl}
          refresh={
            <RefreshButton
              label="Refresh pull requests"
              refreshing={list.isFetching}
              onRefresh={list.refresh}
            />
          }
        />
      </div>
      <div className="ws-view-content">
        {list.isPending && (
          <div className="ws-empty">Loading your open pull requests…</div>
        )}
        {list.isError && (
          <div className="ws-callout">
            <strong>Could not load your open pull requests</strong>
            <span>{list.error?.message}</span>
          </div>
        )}
        {!list.isPending && !list.isError && (
          <>
            {groups.map((group) => (
              <section
                className="ws-pr-repository-group"
                key={group.repository}
              >
                <h3>{group.repository}</h3>
                <SidebarTable>
                  {group.stacks.map((stack) => (
                    <AuthoredPullRequestStack
                      key={stack.id}
                      stack={stack}
                      repository={group.repository}
                      rpc={rpc}
                      changingDraftUrl={changingDraftUrl}
                      onOpenPullRequest={(url) => navigate.openUrl(url)}
                      onToggleDraft={toggleDraft}
                      onOpenThread={onOpenThread}
                      threadsByBranch={threadsByBranch}
                    />
                  ))}
                  {group.ordinary.map((pullRequest) => (
                    <section
                      className="ws-pr-stack ws-pr-stack-singleton"
                      key={pullRequest.url}
                    >
                      <AuthoredPullRequestRow
                        rpc={rpc}
                        pullRequest={pullRequest}
                        linkedThread={threadsByBranch.get(pullRequest.head)}
                        changingDraft={changingDraftUrl === pullRequest.url}
                        onOpenPullRequest={(url) => navigate.openUrl(url)}
                        onOpenThread={onOpenThread}
                        onToggleDraft={toggleDraft}
                      />
                    </section>
                  ))}
                </SidebarTable>
              </section>
            ))}
            {!visible.length && (
              <div className="ws-empty">
                <strong>No open pull requests</strong>
                <span>
                  {effectiveSearchQuery
                    ? `No pull requests match “${effectiveSearchQuery}”.`
                    : "Open pull requests you author on GitHub appear here."}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
