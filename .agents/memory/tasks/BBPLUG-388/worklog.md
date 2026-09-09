# BB 0.42.1 compatibility audit

- Audited immutable `desktop-v0.42.1` at
  `a4aa07f9ee3fdeb5716a26a368246ea1ef9e0b78`.
- SDK remains `0.4.47`; Work Sidebar's exact pin is unchanged.
- AskUserQuestion, Automations, and Tasks upstream sources are unchanged from
  0.42.0 and all three local patches apply without modification.
- Added a 0.42.1 catalog entry and made pre-release sync builds use the target
  bundle's CLI so artifact metadata cannot silently reflect the live older app.
- Full 0.42.1 patch preflight: 101 core, 87 AskUserQuestion, 81 Automations,
  and 368 Tasks tests passed; all typechecks/builds passed; staged artifacts
  report BB 0.42.1 / SDK 0.4.47.
- Work Sidebar: 108 files / 759 tests passed; typecheck, current and staged SDK
  checks, current and staged builds, and `git diff --check` passed.
- No patch was deployed because the downloaded 0.42.1 app is not active. The
  running app/server/CLI remain 0.42.0, so live deployment and smoke tests are
  deferred until the desktop update is activated.
