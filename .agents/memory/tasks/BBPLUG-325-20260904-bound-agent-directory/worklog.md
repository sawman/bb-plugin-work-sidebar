# BBPLUG-325 evidence

## Base and scope

- Verified before edits: `0c039f60047fa321d905fe5b32d09a590851cae1`.
- Replaced roster-shaped agent-detail cache keys with one bounded normalized
  directory. The server RPC contract remains unchanged.

## Red

- `npm test -- --no-file-parallelism features/agents/tests/queries.test.tsx`
  initially failed: the prior policy used infinite GC, a cross-panel roster
  fetched an already-known fact again, and no directory maximum existed.
- The clean managed worktree initially lacked `node_modules`; `npm ci` restored
  the locked local test toolchain before recording the RED output.

## Green design

- One `agents.directory()` Query key stores per-thread model facts.
- Active Agents observers register their host-derived rosters; unmount and
  roster updates reconcile stale facts out of the directory.
- Missing details are fetched in server-contract-sized batches (100 IDs).
- The directory has a finite 15-minute GC policy and an explicit 200-fact cap.
- The Work refresh action clears and invalidates only this directory, allowing
  active observers to retrieve their current roster again.

## Final verification

- Focused Agents suites passed twice: 4 files / 27 tests each run.
- Full serial suite passed twice: 99 files / 643 tests in 57.45s and 57.28s.
- `npm run typecheck` passed.
- `bb plugin types --check .` passed with SDK and host pinned at `0.4.34`.
- `npm run build` passed. It emitted only Node's existing `DEP0205`
  deprecation warning.
- `git diff --check` passed.
