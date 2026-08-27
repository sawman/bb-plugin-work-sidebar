import {
  useCallback,
  useEffect,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useStore } from "zustand";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import {
  AuthoredPullRequestRow,
  AuthoredPullRequestStack,
  type AuthoredPullRequest,
} from "@/components/threads/authored-pull-requests";
import type { rpcContract } from "../../contracts";
import { orderStackLayers, type SidebarStack } from "../../work-model";
import { pullRequestsSidebarStore } from "./store";
import { githubHealthPresentation } from "./presentation";
import {
  useAuthoredPullRequests,
  useGitHubApiHealth,
  useSetAuthoredPullRequestDraft,
} from "./queries";

const EMPTY_PULL_REQUESTS: AuthoredPullRequest[] = [];

export interface PullRequestsLeftSidebarProps {
  active: boolean;
  searchQuery: string;
}

/** The Pull Requests slice owns authored-PR loading, drafting, grouping and selection. */
export function PullRequestsLeftSidebar({
  active,
  searchQuery,
}: PullRequestsLeftSidebarProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { values: settings } = useSettings();
  const list = useAuthoredPullRequests(rpc, {
    intervalMs: Number(settings?.githubLeftListRefreshSeconds ?? "300") * 1_000,
  });
  const draft = useSetAuthoredPullRequestDraft(rpc);
  const healthQuery = useGitHubApiHealth(rpc, { poll: true });
  const selectedIds = useStore(
    pullRequestsSidebarStore,
    (state) => state.selectedIds,
  );
  const anchorId = useStore(
    pullRequestsSidebarStore,
    (state) => state.selectionAnchorId,
  );
  const pullRequests = (list.data ?? EMPTY_PULL_REQUESTS) as AuthoredPullRequest[];
  const visible = useMemo(
    () =>
      pullRequests.filter((pullRequest) => {
        const needle = searchQuery.trim().toLocaleLowerCase();
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
      }),
    [pullRequests, searchQuery],
  );
  const groups = useMemo(() => {
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
  }, [visible]);
  const visibleIds = useMemo(
    () => [
      ...new Set([
        ...groups.flatMap((group) =>
          group.stacks.flatMap((stack) =>
            orderStackLayers(stack.pullRequests, stack.base).map(
              (layer) => layer.url,
            ),
          ),
        ),
        ...groups.flatMap((group) =>
          group.ordinary.map((pullRequest) => pullRequest.url),
        ),
      ]),
    ],
    [groups],
  );
  useEffect(() => {
    pullRequestsSidebarStore
      .getState()
      .reconcileRoster(pullRequests.map((pullRequest) => pullRequest.url));
  }, [pullRequests]);
  const select = useCallback(
    (url: string, event: ReactMouseEvent<HTMLAnchorElement>) => {
      const state = pullRequestsSidebarStore.getState();
      if (event.shiftKey && anchorId) {
        const first = visibleIds.indexOf(anchorId);
        const last = visibleIds.indexOf(url);
        state.setSelected(
          first >= 0 && last >= 0 ? anchorId : url,
          first >= 0 && last >= 0
            ? visibleIds.slice(Math.min(first, last), Math.max(first, last) + 1)
            : [url],
        );
        return true;
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(state.selectedIds);
        if (next.has(url)) next.delete(url);
        else next.add(url);
        state.setSelected(url, next);
        return true;
      }
      state.setSelected(url, [url]);
      return false;
    },
    [anchorId, visibleIds],
  );
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
          {visible.length} open pull request{visible.length === 1 ? "" : "s"}
        </span>
        <span className="ws-work-toolbar-actions">
          {health && (
            <span
              className={`ws-github-api-indicator ws-github-api-${health.tone}`}
              title={healthState.message ?? health.label}
            >
              <Icon name={health.icon} aria-hidden />
              {health.label}
            </span>
          )}
          {selectedIds.size > 1 && (
            <span className="ws-selection-count" role="status">
              {selectedIds.size} selected
            </span>
          )}
          <button
            className="ws-icon-button"
            title="Refresh pull requests"
            aria-label="Refresh pull requests"
            disabled={list.isFetching}
            onClick={() => void list.refresh().catch(() => undefined)}
          >
            <Icon name="RefreshCw" aria-hidden />
          </button>
        </span>
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
                {group.stacks.map((stack) => (
                  <AuthoredPullRequestStack
                    key={stack.id}
                    stack={stack}
                    selectedIds={selectedIds}
                    changingDraftUrl={changingDraftUrl}
                    onSelect={select}
                    onToggleDraft={toggleDraft}
                  />
                ))}
                {group.ordinary.map((pullRequest) => (
                  <section
                    className="ws-pr-stack ws-pr-stack-singleton"
                    key={pullRequest.url}
                  >
                    <AuthoredPullRequestRow
                      pullRequest={pullRequest}
                      selected={selectedIds.has(pullRequest.url)}
                      changingDraft={changingDraftUrl === pullRequest.url}
                      onSelect={select}
                      onToggleDraft={toggleDraft}
                    />
                  </section>
                ))}
              </section>
            ))}
            {!visible.length && (
              <div className="ws-empty">
                <strong>No open pull requests</strong>
                <span>
                  {searchQuery
                    ? `No pull requests match “${searchQuery}”.`
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
