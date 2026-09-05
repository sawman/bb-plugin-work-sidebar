import { useEffect, useMemo, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import { CopyBadge } from "../../components/ui/copy-badge";
import { CountedDisclosure } from "../../components/ui/counted-disclosure";
import { Icon } from "../../components/ui/icon";
import { SearchCombobox } from "../../components/ui/combobox";
import { SurfaceCard, SurfaceCardHeading } from "../../components/ui/surface-card";
import { messageIsInbox, messageIsSaved, messageLabel, splitInboxMarkdown } from "./model";
import {
  useInboxMessages,
  useInboxMutations,
} from "./queries";
import type { HumanMessage } from "./schemas";

export function InboxCard({ threadId }: { threadId: string }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  const query = useInboxMessages(threadId, search);
  const mutations = useInboxMutations(threadId);
  const searchActive = search.trim().length > 0;
  const messages = query.data?.messages ?? [];
  const inboxMessages = useMemo(() => messages.filter(messageIsInbox), [messages]);
  const savedMessages = useMemo(() => messages.filter(messageIsSaved), [messages]);

  return (
    <SurfaceCard className="ws-inbox-card" data-card="inbox">
      <SurfaceCardHeading
        title="Inbox"
        trailing={query.data && query.data.activeCount > 0 ? (
          <span className="ws-inbox-unread-count" aria-label={`${query.data.activeCount} unread messages`}>
            {query.data.activeCount}
          </span>
        ) : undefined}
      />
      <h2 className="ws-sr-only">Inbox</h2>
      <div className="ws-inbox-content">
        <SearchCombobox
          ariaLabel="Search Inbox messages"
          emptyMessage=""
          listboxLabel="Search Inbox messages"
          onOpenChange={() => undefined}
          onQueryChange={setSearchDraft}
          onSelectionChange={() => undefined}
          open={false}
          options={[]}
          placeholder="Search messages"
          query={searchDraft}
          searchOnly
          selectedValues={[]}
        />
        {query.isInitialPending ? <InboxLoading /> : null}
        {query.error && !query.data ? (
          <div className="ws-inbox-state" role="alert">
            <span>Could not load Inbox: {query.error.message}</span>
            <button type="button" onClick={() => void query.refetch()}>
              Retry Inbox
            </button>
          </div>
        ) : null}
        {query.data ? (
          searchActive ? (
            <InboxResults
              messages={messages}
              hasNextPage={query.hasNextPage}
              fetching={query.isFetching}
              onLoadMore={query.fetchNextPage}
              mutations={mutations}
            />
          ) : (
            <>
              <CountedDisclosure
                className="ws-inbox-group"
                triggerClassName="ws-inbox-group-trigger"
                countClassName="ws-inbox-group-count"
                title="Inbox messages"
                count={query.data?.activeCount ?? 0}
                countUnit="message"
                defaultOpen
              >
                {inboxMessages.length ? (
                  <InboxMessageList messages={inboxMessages} mutations={mutations} />
                ) : (
                  <p className="ws-inbox-empty">No unread messages. Agents leave only key answers, decisions, and handoffs here.</p>
                )}
              </CountedDisclosure>
              <CountedDisclosure
                className="ws-inbox-group"
                triggerClassName="ws-inbox-group-trigger"
                countClassName="ws-inbox-group-count"
                title="Saved messages"
                count={query.data?.savedCount ?? 0}
                countUnit="message"
                defaultOpen
              >
                {savedMessages.length ? (
                  <InboxMessageList messages={savedMessages} mutations={mutations} />
                ) : (
                  <p className="ws-inbox-empty">No saved messages.</p>
                )}
              </CountedDisclosure>
              {query.hasNextPage ? (
                <LoadMoreButton fetching={query.isFetching} onClick={query.fetchNextPage} />
              ) : null}
            </>
          )
        ) : null}
        {query.error && query.data ? (
          <div className="ws-inbox-state" role="alert">
            <span>Could not load more Inbox messages: {query.error.message}</span>
            <button type="button" onClick={() => void query.retryFailedPage()}>
              Retry loading messages
            </button>
          </div>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

function InboxLoading() {
  return <p className="ws-inbox-state" role="status" aria-busy="true">Loading Inbox…</p>;
}

function InboxResults({
  messages,
  hasNextPage,
  fetching,
  onLoadMore,
  mutations,
}: {
  messages: readonly HumanMessage[];
  hasNextPage: boolean;
  fetching: boolean;
  onLoadMore(): void;
  mutations: ReturnType<typeof useInboxMutations>;
}) {
  return (
    <section className="ws-inbox-results" aria-label="Inbox search results">
      <h3>Search results</h3>
      {messages.length ? <InboxMessageList messages={messages} mutations={mutations} /> : <p className="ws-inbox-empty">No matching Inbox history.</p>}
      {hasNextPage ? <LoadMoreButton fetching={fetching} onClick={onLoadMore} /> : null}
    </section>
  );
}

function LoadMoreButton({ fetching, onClick }: { fetching: boolean; onClick(): void }) {
  return <button className="ws-inbox-load-more" type="button" onClick={onClick} disabled={fetching}>{fetching ? "Loading more…" : "Load more messages"}</button>;
}

function InboxMessageList({
  messages,
  mutations,
}: {
  messages: readonly HumanMessage[];
  mutations: ReturnType<typeof useInboxMutations>;
}) {
  return <ul className="ws-inbox-message-list">{messages.map((message) => <InboxMessageRow key={message.id} message={message} mutations={mutations} />)}</ul>;
}

function InboxMessageRow({
  message,
  mutations,
}: {
  message: HumanMessage;
  mutations: ReturnType<typeof useInboxMutations>;
}) {
  const [expanded, setExpanded] = useState(true);
  const acknowledgeBusy = mutations.acknowledge.isPending && mutations.acknowledge.variables?.messageId === message.id;
  const bookmarkBusy = mutations.bookmark.isPending && mutations.bookmark.variables?.messageId === message.id;
  const busy = acknowledgeBusy || bookmarkBusy;
  const error = mutations.acknowledge.variables?.messageId === message.id
    ? mutations.acknowledge.error
    : mutations.bookmark.variables?.messageId === message.id
      ? mutations.bookmark.error
      : null;
  const acknowledge = () => mutations.acknowledge.mutate({ messageId: message.id, revision: message.revision });
  const bookmark = () => mutations.bookmark.mutate({ messageId: message.id, bookmarked: !message.bookmarkedAt, revision: message.revision });
  return (
    <li className="ws-inbox-message" data-message-id={message.id} data-busy={busy ? "true" : undefined}>
      <div className="ws-inbox-message-heading">
        <strong>{messageLabel(message)}</strong>
        <div className="ws-inbox-message-actions">
          <ActionTooltip label={message.acknowledgedAt ? "Already acknowledged" : "Acknowledge message"}>
            {(tooltipId) => (
              <button
                type="button"
                aria-describedby={tooltipId}
                aria-label={`Acknowledge message ${message.id}`}
                onClick={acknowledge}
                disabled={busy || Boolean(message.acknowledgedAt)}
              >
                <Icon name="Check" aria-hidden />
              </button>
            )}
          </ActionTooltip>
          <ActionTooltip label={message.bookmarkedAt ? "Remove bookmark" : "Bookmark message"}>
            {(tooltipId) => (
              <button
                type="button"
                aria-describedby={tooltipId}
                aria-label={`${message.bookmarkedAt ? "Remove bookmark from" : "Bookmark"} message ${message.id}`}
                onClick={bookmark}
                disabled={busy}
              >
                <Icon name={message.bookmarkedAt ? "BookmarkX" : "Bookmark"} aria-hidden />
              </button>
            )}
          </ActionTooltip>
        </div>
      </div>
      <div className="ws-inbox-message-meta">
        {message.agentLabel ? <span>{message.agentLabel}</span> : null}
        <time dateTime={message.createdAt}>Created {formatTimestamp(message.createdAt)}</time>
        {message.updatedAt !== message.createdAt ? <time dateTime={message.updatedAt}>Edited {formatTimestamp(message.updatedAt)}</time> : null}
      </div>
      <CopyBadge value={message.id} label="message ID" title={`Copy ${message.id}`}>
        <code>{message.id}</code>
      </CopyBadge>
      <button type="button" className="ws-inbox-message-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Collapse message body" : "Show message body"}
      </button>
      {expanded ? <InboxMessageContent content={message.body} /> : null}
      {error ? <p className="ws-inbox-mutation-error" role="alert">{error.message} Refresh and retry.</p> : null}
    </li>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function InboxMessageContent({ content }: { content: string }) {
  return (
    <div className="ws-inbox-message-content">
      {splitInboxMarkdown(content).map((segment, index) => (
        segment.kind === "mermaid" ? (
          <MermaidBlock key={`mermaid-${index}`} content={segment.content} />
        ) : (
          <Markdown key={`markdown-${index}`} content={segment.content} />
        )
      ))}
    </div>
  );
}

function MermaidBlock({ content }: { content: string }) {
  return (
    <div className="ws-inbox-mermaid" data-state="fallback">
      <pre aria-label="Mermaid diagram source"><code>{content}</code></pre>
      <span className="ws-inbox-mermaid-fallback">
        Mermaid rendering is disabled in this bundle; showing source.
      </span>
    </div>
  );
}
