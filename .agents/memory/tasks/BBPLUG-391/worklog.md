# BBPLUG-391 — acknowledged Inbox history

## Outcome

Expose acknowledged, unbookmarked Inbox messages in a collapsed History group
without introducing a second store, query family, or message-row component.

## RED

The focused Inbox suite initially failed because:

- no History classifier existed;
- the default server projection excluded acknowledged, unbookmarked records;
- the strict response had no history count; and
- the Work card rendered only Messages and Saved.

## GREEN

- The existing SQLite list projection now returns all thread messages and exact
  active/saved/history counts.
- Messages, Saved, and History are mutually exclusive projections of the same
  paginated Query data.
- History uses the shared WorkSection and InboxMessageList components and is
  collapsed by default.
- Search continues to replace the default groups and spans the full history.
- Optimistic acknowledge/bookmark updates move counts between all three groups
  and retain record-scoped rollback behavior.

## Verification

- Focused Inbox suite: 6 files / 93 tests, passed twice.
- Full serial suite: 108 files / 766 tests, passed twice.
- Typecheck: passed.
- SDK compatibility: plugin pin and host both 0.4.47.
- Production build: passed; only the known Node DEP0205 warning.
- Theme-control matrix: light/dark preference application and restoration
  passed; the foreground thread did not have the Inbox card mounted, so the
  matrix yielded no computed Inbox sample.
- Source resolution: canonical checkout resolved exactly.
- Plugin reload: `work-sidebar@0.1.0-recovery.0` running from the canonical
  checkout.
- Diff check: passed.

Commit and push evidence are recorded on the durable task after publication.
