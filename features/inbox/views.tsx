import { useEffect, useId, useMemo, useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import { Icon, type IconName } from "../../components/ui/icon";
import { SearchCombobox } from "../../components/ui/combobox";
import { SurfaceCard, SurfaceCardHeading } from "../../components/ui/surface-card";
import { WorkSection } from "../../components/ui/work-section";
import { messageIsInbox, messageIsSaved, messageLabel, splitInboxMarkdown } from "./model";
import {
  useInboxMessages,
  useInboxMessageMutationState,
  useInboxMutations,
} from "./queries";
import type { HumanMessage } from "./schemas";

const messageTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function InboxCard({ threadId }: { threadId: string }) {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
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
  const closeSearch = () => {
    setSearchDraft("");
    setSearch("");
    setSearchOpen(false);
  };

  return (
    <SurfaceCard className="ws-inbox-card" data-card="inbox">
      <SurfaceCardHeading
        title="Inbox"
        trailing={(
          <InboxHeadingActions
            activeCount={query.data?.activeCount ?? 0}
            open={searchOpen}
            query={searchDraft}
            onClose={closeSearch}
            onOpenChange={setSearchOpen}
            onQueryChange={setSearchDraft}
          />
        )}
      />
      <h2 className="ws-sr-only">Inbox</h2>
      <div className="ws-inbox-content">
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
              <WorkSection
                title="Messages"
                count={query.data?.activeCount ?? 0}
                countUnit="message"
                defaultOpen
                metaSpacing="relaxed"
              >
                {inboxMessages.length ? (
                  <InboxMessageList messages={inboxMessages} mutations={mutations} />
                ) : null}
              </WorkSection>
              <WorkSection
                title="Saved"
                count={query.data?.savedCount ?? 0}
                countUnit="message"
                defaultOpen
                metaSpacing="relaxed"
              >
                {savedMessages.length ? (
                  <InboxMessageList messages={savedMessages} mutations={mutations} />
                ) : null}
              </WorkSection>
              {query.hasNextPage ? (
                <LoadMoreButton fetching={query.isFetching} onClick={query.fetchNextPage} />
              ) : null}
            </>
          )
        ) : null}
        {query.error && query.data && query.isFetchNextPageError ? (
          <div className="ws-inbox-state" role="alert">
            <span>Could not load more Inbox messages: {query.error.message}</span>
            <button type="button" disabled={query.isFetching} onClick={() => void query.retryFailedPage()}>
              Retry loading messages
            </button>
          </div>
        ) : null}
        {query.error && query.data && !query.isFetchNextPageError ? (
          <div className="ws-inbox-state" role="alert">
            <span>Could not refresh Inbox: {query.error.message}</span>
            <button type="button" onClick={() => void query.refetch()}>
              Retry Inbox
            </button>
          </div>
        ) : null}
      </div>
    </SurfaceCard>
  );
}

function InboxHeadingActions({
  activeCount,
  open,
  query,
  onClose,
  onOpenChange,
  onQueryChange,
}: {
  activeCount: number;
  open: boolean;
  query: string;
  onClose(): void;
  onOpenChange(open: boolean): void;
  onQueryChange(value: string): void;
}) {
  return (
    <span className="ws-inbox-heading-actions">
      {activeCount > 0 ? (
        <span className="ws-inbox-unread-count" aria-label={`${activeCount} unread messages`}>
          {activeCount}
        </span>
      ) : null}
      {open ? (
        <SearchCombobox
          ariaLabel="Search Inbox messages"
          autoFocus
          emptyMessage=""
          hideResults
          inputClassName="ws-inbox-search-input"
          listboxLabel="Search Inbox messages"
          onDismiss={onClose}
          onOpenChange={onOpenChange}
          onQueryChange={onQueryChange}
          onSelectionChange={() => undefined}
          open
          options={[]}
          placeholder="Search messages…"
          query={query}
          searchOnly
          selectedValues={[]}
        />
      ) : null}
      <ActionTooltip label={open ? "Close search" : "Search"}>
        {(tooltipId) => (
          <button
            type="button"
            className="ws-inbox-search-trigger"
            data-active={open || undefined}
            aria-label="Search Inbox"
            aria-describedby={tooltipId}
            aria-expanded={open}
            onClick={() => open ? onClose() : onOpenChange(true)}
          >
            <Icon name="Search" aria-hidden />
          </button>
        )}
      </ActionTooltip>
    </span>
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

function InboxMessageAction({
  tooltip,
  ariaLabel,
  icon,
  disabled = false,
  expanded,
  controls,
  onClick,
}: {
  tooltip: string;
  ariaLabel: string;
  icon: IconName;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  onClick(): void;
}) {
  return (
    <ActionTooltip label={tooltip}>
      {(tooltipId) => (
        <button
          type="button"
          className="ws-inbox-message-action"
          aria-describedby={tooltipId}
          aria-label={ariaLabel}
          aria-expanded={expanded}
          aria-controls={controls}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon name={icon} aria-hidden />
        </button>
      )}
    </ActionTooltip>
  );
}

function InboxMessageRow({
  message,
  mutations,
}: {
  message: HumanMessage;
  mutations: ReturnType<typeof useInboxMutations>;
}) {
  const [expanded, setExpanded] = useState(true);
  const bodyId = useId();
  const { busy, error } = useInboxMessageMutationState(message.threadId, message.id);
  const acknowledge = () => mutations.acknowledge.mutate({ messageId: message.id, revision: message.revision });
  const bookmark = () => mutations.bookmark.mutate({ messageId: message.id, bookmarked: !message.bookmarkedAt, revision: message.revision });
  const copyId = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(message.id);
        toast.success("Copied message ID");
      } catch {
        toast.error("Could not copy message ID");
      }
    })();
  };
  return (
    <li className="ws-inbox-message" data-message-id={message.id} data-busy={busy ? "true" : undefined}>
      <div className="ws-inbox-message-heading">
        <ActionTooltip label="Copy ID">
          {(tooltipId) => (
            <button
              type="button"
              className="ws-inbox-message-title-copy"
              aria-describedby={tooltipId}
              aria-label={`Copy message ID ${message.id}`}
              onClick={copyId}
            >
              <strong>{messageLabel(message)}</strong>
            </button>
          )}
        </ActionTooltip>
        <time
          dateTime={message.createdAt}
          aria-label={`Created ${formatTimestamp(message.createdAt)}`}
        >
          {formatMessageAge(message.createdAt)}
        </time>
        <div className="ws-inbox-message-actions">
          <InboxMessageAction
            tooltip={message.acknowledgedAt ? "Acknowledged" : "Acknowledge"}
            ariaLabel={`Acknowledge message ${message.id}`}
            icon="Check"
            disabled={busy || Boolean(message.acknowledgedAt)}
            onClick={acknowledge}
          />
          <InboxMessageAction
            tooltip={message.bookmarkedAt ? "Remove bookmark" : "Bookmark"}
            ariaLabel={`${message.bookmarkedAt ? "Remove bookmark from" : "Bookmark"} message ${message.id}`}
            icon={message.bookmarkedAt ? "BookmarkX" : "Bookmark"}
            disabled={busy}
            onClick={bookmark}
          />
          <InboxMessageAction
            tooltip={expanded ? "Collapse" : "Expand"}
            ariaLabel={`${expanded ? "Collapse" : "Expand"} message body`}
            icon={expanded ? "ChevronUp" : "ChevronDown"}
            expanded={expanded}
            controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
          />
        </div>
      </div>
      {expanded ? <InboxMessageContent id={bodyId} content={message.body} /> : null}
      {error ? <p className="ws-inbox-mutation-error" role="alert">{error.message} Refresh and retry.</p> : null}
    </li>
  );
}

function formatTimestamp(value: string) {
  return messageTimestampFormatter.format(new Date(value));
}

export function formatMessageAge(value: string, now = Date.now()) {
  const createdAt = new Date(value).getTime();
  if (!Number.isFinite(createdAt)) return "now";
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function InboxMessageContent({ content, id }: { content: string; id?: string }) {
  return (
    <div id={id} className="ws-inbox-message-content">
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
