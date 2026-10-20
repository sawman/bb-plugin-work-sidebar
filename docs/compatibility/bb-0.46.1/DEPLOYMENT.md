# BB 0.46.1 deployment and acceptance record

Root deployed on 2026-10-20 from immutable `desktop-v0.46.1` source
`411eac54ac16d0a3cb57d1de8396d37564884a73`, with SDK `0.6.49`.
This record was prepared from canonical `main` at
`8c94ee32dab5e1603b338fe2445e71242fa5f013` and root's explicit handoff.
The earlier worker [audit](README.md), [validation](validation.json), staged
[artifact manifest](artifacts.json), and compressed raw evidence remain historical
preflight records; they are not overwritten by this deployment record.

## Deployed artifacts and rollback

- Final stage: `/Users/matthewsaw/.bb/patch-staging/bb-0.46.1-2026-10-20T08-16-46-219Z`.
- Fresh backup: `/Users/matthewsaw/.bb/patch-backups/bb-0.46.1-2026-10-20T08-19-06-964Z`.
- [deployment-artifacts.json](deployment-artifacts.json) is an exact copy of
  root's handed-off `deployed-artifacts.json`, recording all twelve Questions
  and Tasks dist file SHA-256 values and sizes. Root verified every installed
  file byte-for-byte against the final stage (12/12), including metadata for
  BB 0.46.1 / SDK 0.6.49.
- Automations remains pristine: all seven installed dist files matched the
  pristine package. The retired personal-project patch was not deployed.
- Version-matched pristine rollback archives and member SHA-256 values remain
  tracked in [rollback/bb-0.46.1](../../../bb-plugins/rollback/bb-0.46.1/README.md).
  Restore only to BB 0.46.1, using the documented matching plugin dist target.

Both retained patches remain plugin-only. No core files were deployed and no
core restart was performed. Questions retains the accumulating ACP queue and
nonblocking auto delivery; Tasks retains indexed reverse reads and CLI caller
parent forwarding. Removal still requires equivalent native behavior and a
coordinated migration of the completed-task preview consumer.

## Validation and bounded live acceptance

Root's full Work Sidebar gate on code commit `3b1a7e8` passed **117 files /
898 tests in 92.89 seconds**. Typecheck, SDK 0.6.49 compatibility check and
production build passed. Subsequent integration commits before this record
changed documentation/gzip evidence only. Deployment repeated **Questions 51 /
Tasks 409 tests**, their typechecks and builds, then verified installed hashes.
The earlier pristine Automations 136-test/typecheck and manual eight-check Tasks
probe results remain in the worker audit. No heavy tests were rerun for this
docs-only acceptance amendment.

Canonical Work Sidebar reloaded with SDK 0.6.49, runtime
`1fe69235e4fd4a21`. The live Tasks reverse RPC now succeeds (it returned 404
before deployment) and returns scoped completed-task preview rows with a limit
of five. Root mounted left Threads/Tasks/PRs and right Work/Changes/Agents,
observed no accessibility alerts, and inspected light/dark screenshots. The
original theme was restored.

Those checks are bounded: keyboard behavior, drag/drop, narrow widths and every
loading/empty/error/selected/expanded/busy state were not exhaustively exercised.
**Live ACP Reply is not verified:** Cursor reports `auth_required`; the async
user question is pending. This is an outstanding acceptance gap, not a pass or
waiver. Production dependency audit reports zero findings. The three known
development dependency findings and Node DEP0205 warning are unchanged.

## Follow-ups and ownership

Root created Agent-owned TODO follow-ups BBPLUG-433 (verify/adopt host Mermaid
for Inbox) and BBPLUG-434 (make the Tasks behavior probe a mandatory sync gate).
The probe remains a manual gate today. No product implementation for either
follow-up is included here. Root retains push, final acceptance, task closure
and archive ownership; this record does not complete or reassign any task.
The shared immutable source and pristine payload paths remain retained until
root acceptance.
