# BB 0.46.0 deployment — 2026-10-13

Reviewed Work Sidebar source `c16ef2076e24dd8f16eb9e3073881d27fc463a83`
and evidence commit `26745e2c6d80642c66803dd7f7f0ab1dbfafc27d` were
fast-forwarded into the registered canonical checkout. Root independently ran
typecheck, SDK 0.6.37 alignment, production build, and whitespace checks.
The final author serial suite passed 812 tests in 110 files; independent
source review closed both migration findings.

Root deployed the already verified Questions/Tasks stage rather than rebuilding
it again. Before copying, every stage SHA-256 and plugin/BB/SDK metadata was
validated. All 12 installed files were compared afterward and match:

- Stage: `/Users/matthewsaw/.bb/patch-staging/bb-0.46.0-2026-10-13T05-56-48-377Z`
- Manifest SHA-256: `da7aa88b7f2eb2a55dd6e091eec37fdd16a16414a859ba1be8599d12c1d8800a`
- Fresh pre-deployment backup: `/Users/matthewsaw/.bb/patch-backups/bb-0.46.0-2026-10-13-root-verified-stage`
- Version-matched pristine rollback packages remain tracked in
  `bb-plugins/rollback/bb-0.46.0/`.

Questions, Tasks, and Work Sidebar were reloaded. Runtime readback shows all
three running with compatible SDK 0.6.37 bundles. Native Automations was left
unmodified: exact-source review, upstream personal-project tests, and a live
`proj_personal` read justify retirement of its fallback for this release.

Floating Ghostty `0bda8dc5941dcbf4d40a02cdd8ce744314576ce5` was pushed and
activated through its managed Git installation. Its final serial suite passed
248 tests with one unavailable-shell skip. Independent review, typecheck,
production app/server/host builds, and clean omit-dev packaging passed.
An immediate post-install live smoke missed its shell marker within five
seconds; an unchanged rerun and three fresh-shell probes subsequently passed,
including real WASM cell rendering and smoke-owned shell cleanup. The owning
terminal worker separated startup readiness from command verification in
smoke-only follow-up `6a2ceb2d6bad40af5bd4ad85e1f34e75d32dbc76`, preserving
the five-second real-cell assertion and owned cleanup. Its 56 focused tests,
typecheck, and three live smoke runs passed; independent exact-SHA review was
clean. This is not a production runtime change. The initial failure did not
reproduce, so startup timing remains an evidence-supported explanation, not
a conclusively reproduced root cause.

Visual desktop checks remain unverified. A fresh computer-control session
reported `desktop_unlocked: false`; root closed its session and its daemon,
without foregrounding BB, bypassing access, or touching user terminals.
Handler error counters are aggregate history, not proof of new deployment
errors; runtime status details are clear. Existing DEP0205 and development-only
audit findings remain recorded in the handoff.
