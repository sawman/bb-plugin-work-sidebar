# Agent-to-human Inbox

Inbox is a one-way, thread-scoped place for key answers, decisions, warnings
and handoffs. Chat and question tools remain the interactive conversation.
Inbox creation never writes a chat turn, pauses or wakes an agent, or routes
agent-to-agent messages. Do not mirror routine progress into it.

## Records and tools

The Inbox slice owns schemas, SQL, service, tools, queries and views. SQLite
owns durable messages; TanStack Query owns browser server state. React owns
search drafts and disclosures. The shared migration list is append-only;
other slices do not query the Inbox table.

Each message has a stable `msg_` ID, thread/project, optional subject (160
characters), required nonblank Markdown body (32 KiB UTF-8), captured agent
identity, created/updated/acknowledged/bookmarked timestamps and a revision.
Every changed content/state write increments revision. Expected-revision
updates use compare-and-set; conflicts require refresh/retry. Create retries
may supply an idempotency key and receive the original record.

`leave_human_message`, `read_human_messages` and `update_human_message` operate
only on the calling thread. UI list/acknowledge/bookmark RPCs also scope every
message ID to the requested thread. Missing or cross-thread IDs must not leak
another thread's record. Late creates recheck archival state before commit.
Message bodies never enter routine logs or realtime payloads.

## Presentation and history

The Work Inbox follows Status and unmounts off Work. It shows unread count
(omitted at zero), independent loading/error/retry and three disclosure groups:

- Messages: unacknowledged, newest first.
- Saved: acknowledged and bookmarked, newest update first.
- History: acknowledged and unbookmarked, newest update first; collapsed by
  default.

An unread bookmarked message appears only in Messages. Bodies start collapsed
in every group and search result; expansion does not acknowledge. Rows show
the subject or fallback title and created age/time, with actions to copy the
full ID, acknowledge, bookmark and expand. Agent label and edited time are
stored metadata, not row text; search includes the agent label. The full ID
is available through the copy action and accessible names, not a visible label.
Acknowledgement moves a message into Saved or History. Unbookmarking an
acknowledged record moves it to History. Agent edits retain ID, update time and
clear acknowledgement so changed information receives attention again.
Repeated acknowledgement/bookmark values are idempotent and emit no duplicate
invalidation. Individual deletion is unavailable.

Search replaces the default groups and covers subject, body, ID and agent
label across all retained history. Wildcards and punctuation are literal.
Each page is at most 100 records and 256 KiB JSON. Thread plus normalized
search identifies one sequential infinite-query chain; refetch starts at page
one and obtains later cursors from refreshed predecessors, avoiding stale
cursor branches. Mutations invalidate only the affected thread's Inbox keys
through the validated `inbox` realtime family. Failures stay local to Inbox.

## Retention and lifecycle

The hard cap is 500 messages per thread, including bookmarks. Transactional
retention after create (also allowed during startup reconciliation) preserves
the incoming record and evicts from existing records: oldest
acknowledged/unbookmarked first, then unacknowledged/unbookmarked, then
bookmarked. Thus a new message survives even when all 500 existing records
are bookmarked. Bookmarks never promise permanent retention.

Archive and delete events purge the exact thread, with descendant cleanup
driven by BB's per-thread cascade events. Cleanup is safe to retry; failures
are logged with thread ID. A list already in flight can briefly contain a
purged record; the invalidation and next read must return empty. Disposal
leaves no owned listeners/timers, pending writes or frontend observers.

## Rendering and current limitation

Ordinary Markdown, links and emoji use host Markdown and BB browser
preferences. Complete fenced blocks with info string exactly `mermaid` are
currently intercepted as labelled accessible source. They are **not rendered
diagrams**. Other content, including enclosing fences, remains Markdown.

BBPLUG-433 tracks adopting the existing lazy host Mermaid path, with live
security/accessibility/theme/narrow-width acceptance. The host already has
this capability; the limitation is the plugin's interception. Do not bundle
another Mermaid renderer or claim the follow-up is complete. Preserve safe
source fallback and browser/server import boundaries. The
[compatibility watchlist](../bb-compatibility-watchlist.md) records host evidence.

Keyboard controls, shared search, focus return, terse tooltips, local conflict
recovery and minimum-width usability in both themes remain contract checks.
Per-task evidence distinguishes automated coverage from live acceptance;
this reference does not certify all provider or visual states.
