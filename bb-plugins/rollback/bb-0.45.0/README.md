# BB 0.45.0 rollback artifacts

These archives contain the exact bundled plugin artifacts backed up immediately
before the local 2026-10-09 deployment. Each server metadata file identifies BB
0.45.0 and SDK 0.6.15. This is an unpatched, version-matched rollback, not a
cross-version downgrade.

Verify archive SHA-256 values against `manifest.json` before extracting. Restore
only to the matching BB 0.45.0 bundle, replacing the corresponding plugin's
`dist` artifacts, then reload that plugin. Do not restore these into another BB
version. Settings, databases, schedules, and user sessions are not included.

Original local backup:
`~/.bb/patch-backups/bb-0.45.0-2026-10-09T04-31-44-573Z`.
