# UPSTREAM BB COMPATIBILITY WATCHLIST

This is compatibility documentation only, not the repository work queue. BB Tasks remains the source of truth for repository work.

## Check later

- [ ] Builtin Tasks command `bb tasks dispatch` does not propagate the invoking thread ID as `parentThreadId` (BBPLUG-230). Current workaround: use `bb thread spawn --parent-self --new-environment worktree`, then run `bb tasks attach <key>` from the spawned child. Remove this item when the Tasks delegate RPC and CLI forward `parentThreadId`.
- [ ] The BB SDK/host does not provide durable composer-draft state for unselected thread rows on older hosts, so the plugin cannot derive a draft indicator purely from host state across refresh. Current workaround in `features/threads/thread-attention.ts` uses `hasComposerDraft` when supplied, otherwise only legacy `draft`/`working-draft` row indicators; it never infers state from the mounted, selection-dependent composer. Remove this item when the SDK exposes durable per-thread draft metadata or an event.
