# BBPLUG-392 — collapse Inbox message bodies by default

## Outcome

Inbox message rows now start with their Markdown bodies collapsed in Messages,
Saved, History, and search results. The existing per-row chevron expands and
collapses the body without changing message state.

## RED/GREEN

The mounted row test was inverted first and failed because the initial control
was still `Collapse message body` with rendered content. Setting the row-local
disclosure state to false made the initial control `Expand message body` and
kept the existing round-trip toggle behavior.

## Verification

Final gate, reload, commit, and push evidence are recorded on the durable task.
