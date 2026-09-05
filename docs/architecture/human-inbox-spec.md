# Agent-to-human Inbox specification

Status: Proposed for implementation  
Owner: Work Sidebar  
Product surface: right Work panel and agent tools

## 1. Goal

Add a durable, one-way Inbox where an agent can leave a small number of key
answers, decisions, warnings, and handoff notes for the human without relying
on the human finding the original chat turn later.

The Inbox is not another conversation stream. It is an asynchronous
agent-to-human communication surface with stable message identifiers,
acknowledgement, bookmarking, search, bounded history, and thread-lifecycle
cleanup.

## 2. Background and constraints

Long-running threads can contain several tasks after a user asks a question.
The requested answer may scroll out of view before the user returns. Chat
messages remain the source conversation, but they are not a reliable personal
inbox for important results.

The feature must preserve the repository's existing architecture:

- a new `features/inbox` vertical slice owns its schemas, storage, server
  service, tools, queries, model, view, and tests;
- SQLite owns the durable message dataset; plugin KV is not suitable for a
  searchable collection or the 256 KiB value limit;
- TanStack Query owns frontend server state and mutation lifecycle;
- realtime signals invalidate the Inbox query family and never carry message
  bodies;
- React state owns the open disclosure and search draft;
- the right Work panel composes the card without absorbing Inbox domain logic;
- the app bundle imports server contracts as types and contains no database or
  Node implementation;
- the host `Markdown` component renders ordinary Markdown and colored emoji;
  fenced Mermaid blocks use a feature-owned safe adapter with a code fallback.

## 3. User-visible behavior

### Placement and hierarchy

The Work tab renders an `Inbox` card immediately after Status and before Work
items. Its header shows the unread count; zero is omitted. The card does not
mount while another right-panel tab is active.

The card has two reusable disclosure groups:

1. `Inbox` — unacknowledged messages, newest first.
2. `Saved` — bookmarked messages, newest update first. A bookmarked unread
   message appears only in Inbox until it is acknowledged, avoiding duplicate
   rows.

Acknowledged, unbookmarked history is hidden from the default card but remains
searchable. Search covers subject, Markdown body, message ID, and agent label.
While a query is present the result list replaces the two default groups and
includes matching active, saved, and acknowledged history.

### Message row

Each message presents:

- a stable, copyable message ID;
- an optional short subject and required Markdown body;
- the originating agent/provider label when available;
- created and edited timestamps;
- an acknowledge control;
- a bookmark toggle;

The body can be expanded without changing acknowledgement state. Links follow
BB's normal browser preference through the host Markdown renderer.

### Acknowledge, save, and edit semantics

- Acknowledge sets `acknowledgedAt` and removes the row from Inbox.
- Bookmark sets `bookmarkedAt`. An acknowledged bookmarked message remains in
  Saved.
- Removing the bookmark from an acknowledged message leaves it in hidden,
  searchable history until retention removes it.
- Agent edits preserve the message ID, update `updatedAt`, and clear
  `acknowledgedAt`, because changed key information needs attention again.
- Individual deletion is deliberately unavailable. Acknowledged messages form
  bounded, searchable history until retention or thread lifecycle cleanup.

### Rendering

Ordinary content uses BB's `Markdown` renderer, including native full-colour
emoji. A fenced block whose info string is exactly `mermaid` is split into a
labelled, accessible source block. Mermaid rendering is deferred because the
BB plugin builder emits one app bundle; shipping the dependency would make
the sidebar bundle materially larger. A future genuinely deferred adapter
must use strict security and never accept raw script/HTML execution.

## 4. Functional requirements

### Canonical record

Each persisted message contains:

- `id`: opaque stable identifier beginning with `msg_`;
- `threadId` and `projectId`;
- optional `subject` (maximum 160 characters);
- required `body` (Markdown, maximum 32 KiB UTF-8);
- optional `agentThreadId`, `providerId`, and `agentLabel` captured at create;
- `createdAt`, `updatedAt`, optional `acknowledgedAt`, and optional
  `bookmarkedAt` as ISO timestamps;
- integer `revision`, incremented on every content or state mutation.

The server validates that the calling agent can create only for its current
thread and can update only a message belonging to that thread. UI RPCs
also require the requested thread ID and reject cross-thread message IDs.

### Agent tools and guidance

The plugin registers three native tools for every normal agent session:

- `leave_human_message` creates a message and returns its ID;
- `read_human_messages` gets one ID or searches/lists the current thread;
- `update_human_message` updates a current-thread message.

The tools are one-way communication aids, not agent-to-agent messaging. The
agent instruction contribution says:

> Leave a human Inbox message for key answers, decisions, blockers, warnings,
> or handoff information the user may need later. Do not mirror routine
> progress or every chat response. Ask interactive questions through the
> question tool; when the question or its answer is important, also leave a
> concise Inbox record.

The instruction is deliberately short and provider-neutral. Creating an Inbox
message never pauses or wakes the agent and never writes into the chat
timeline.

### Frontend RPCs

The browser-safe contract exposes strict JSON methods:

- `listHumanMessages({ threadId, query, limit, cursor })`;
- `acknowledgeHumanMessage({ threadId, messageId })`;
- `setHumanMessageBookmark({ threadId, messageId, bookmarked })`;

List results include active/saved counts, a bounded result page, and an opaque
cursor. Search and default projections share one query family keyed by thread,
mode, normalized query, and cursor.

Successful mutations publish one `work-sidebar:changed` signal with family
`inbox` and `threadId`; clients invalidate only that thread's Inbox keys.

### Retention and cleanup

- At most 500 records are retained per thread.
- Retention runs transactionally after every create and may also run during
  service startup migration/reconciliation.
- Eviction order is oldest acknowledged/unbookmarked, then oldest
  unacknowledged/unbookmarked, then oldest bookmarked. The hard cap always
  wins, including when all 500 records are bookmarked.
- `thread.archived` and `thread.deleted` delete every message for that exact
  thread. Cascade archives emit one event per thread, so descendants are
  cleaned without a separate tree walk.
- Failed cleanup is logged once with the thread ID and is safe to retry on a
  later lifecycle event or maintenance pass.
- Reload/dispose leaves no timers, listeners owned outside the plugin
  generation, in-flight writes, or frontend observers.

## 5. Non-functional requirements

- A list or search reads at most 100 records per page and never returns more
  than 256 KiB of JSON.
- SQLite operations use prepared statements and indexed thread/time and
  thread/bookmark/acknowledgement access paths.
- Message bodies never appear in realtime payloads or routine server logs.
- Concurrent mutations use `revision` compare-and-set semantics where an
  expected revision is supplied; conflicts return a concise refresh-and-retry
  error rather than overwriting a newer edit.
- The Inbox card has independent loading, empty, error/retry, populated,
  searching, mutation-busy, and conflict states. Failure cannot blank sibling
  Work cards.
- All controls are keyboard accessible, icon controls have terse primitive
  tooltips, search uses the shared search shell, focus returns after menus and
  confirmation dialogs, and mounted states pass axe.
- The card must remain usable at the minimum right-panel width in both themes.

## 6. Interfaces and ownership

### Storage schema

The shared append-only plugin migration list adds `human_inbox_messages` plus
indexes. The Inbox slice owns all SQL statements and receives the shared
database handle from server composition; other slices never query its table.

### Realtime schema

The central work signal parser adds `{ family: "inbox", threadId }`. The Work
panel invalidates Inbox data for its current thread only. Archive/delete purge
does not need a UI signal for the archived thread, but publishing one is safe
for another still-mounted client.

### Markdown and Mermaid boundary

`InboxMessageContent` splits only complete fenced `mermaid` blocks. All other
text is passed unchanged to BB `Markdown`. Mermaid rendering is intentionally
disabled for the first frontend slice: BB emits one app bundle, and the
measured Mermaid dependency grew `dist/app.js` from 250,023 to 3,718,895
bytes. Fenced blocks therefore remain labelled, accessible source code until
the host exposes a genuinely deferred renderer boundary. No generic Markdown
system or second syntax highlighter is introduced.

## 7. Error and edge-case behavior

- Empty or whitespace-only bodies are rejected before storage.
- Invalid, missing, or cross-thread IDs return not-found semantics without
  revealing another thread's record.
- Duplicate create retries can supply an `idempotencyKey`; the server returns
  the original record rather than duplicating it.
- Two edits with the same prior revision allow only one winner.
- Acknowledging an already acknowledged message and setting the current
  bookmark value are idempotent and do not publish duplicate invalidations.
- Search treats `%`, `_`, quotes, emoji, and Markdown punctuation literally.
- A message archived during an in-flight list may appear in that response, but
  the archive invalidation and next read return empty; a late create checks
  current thread archival state before commit and is rejected.
- Mermaid fences remain an accessible labelled source fallback; ordinary
  Markdown and every message action remain functional.
- The empty card explains that agents leave only key messages; it does not ask
  the human to create content in this one-way surface.

## 8. Acceptance criteria

- Agent create/read/update tools work for Codex, Claude Code, and ACP
  providers through the same plugin registration and strict schemas.
- A created message appears in the currently mounted Work Inbox through one
  targeted realtime invalidation, without manual refresh.
- Acknowledge, bookmark/unbookmark, edit/reopen, search, pagination,
  revision conflicts, idempotent retries, and copyable IDs are covered by
  pure, server, Query, mounted, and accessibility tests.
- The 501st insert evicts exactly one record according to the documented
  priority; each retention tier and all-bookmarked overflow are tested.
- Archive/delete events purge only the affected thread, including cascade
  event sequences, and repeated events are harmless.
- Ordinary Markdown, links, coloured emoji, exact Mermaid-fence segmentation,
  labelled source fallback, and closed-group unmount behavior have regression
  coverage.
- App bundle inspection proves SQLite, Node builtins, server services, and
  contract composition do not enter the browser bundle.
- Focused tests pass twice, the serial full suite passes twice, typecheck, SDK
  compatibility, production build, source verification, reload, diff checks,
  and live light/dark narrow/wide verification pass.

## Out of scope

- Human-to-agent replies or replacing chat/question interactions.
- Agent-to-agent mailboxes or cross-thread routing.
- Individual message deletion before retention or thread cleanup.
- Notifications outside BB, email delivery, or mobile push.
- Retaining Inbox records after archive or delete.
- Unlimited/pinned-forever storage beyond the 500-record thread cap.
