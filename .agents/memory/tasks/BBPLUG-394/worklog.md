# BBPLUG-394 — BB 0.42.1 compatibility audit

- Running BB: 0.42.1
- SDK pin and host SDK: 0.4.47
- Immutable source: `desktop-v0.42.1` at
  `a4aa07f9ee3fdeb5716a26a368246ea1ef9e0b78`
- Patch disposition: AskUserQuestion, Automations, and Tasks remain necessary;
  all apply without modification.
- Patch validation: non-mutating preflight and deploy pass both succeeded.
  AskUserQuestion passed 101 core and 87 plugin tests; Automations passed 81;
  Tasks passed 368. Relevant typechecks and builds passed.
- Deployment: installed artifacts exactly match staging
  `bb-0.42.1-2026-09-11T08-34-36-729Z`; prior artifacts are backed up under
  `~/.bb/patch-backups/bb-0.42.1-2026-09-11T08-36-55-156Z`.
- Activation: built-in plugins were reloaded, then the BB server child was
  restarted without taking over the desktop UI. The replacement server process
  started at 2026-09-11 16:45:54 +08 and exposes the patched core markers.
- SDK disposition: no pin or source changes required.
- Watchlist: #1978, #2200, and #2836 remain open. No open upstream issue or PR
  was found for `listTasksForThread` or the ACP answer continuation.
- Work Sidebar gates: 767/767 tests passed after one known timing-sensitive
  debounce test was isolated at 10/10 and the full suite rerun cleanly;
  typecheck, SDK check, production build, reload, and `git diff --check` passed.
