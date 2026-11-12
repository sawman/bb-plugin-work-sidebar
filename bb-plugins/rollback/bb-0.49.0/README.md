# BB 0.49.0 pristine rollback

Captured read-only from the installed BB 0.49.0 bundle before any worker deployment.
All 21 files across Questions, Tasks and Automations match the locally cached
0.49.0 update ZIP byte-for-byte, including exact directory membership. The ZIP's
SHA-512 matches the updater's local `update-info.json`; installed app code-signature
verification passes. This is local release provenance, not an independent signed
source-to-binary attestation. See [source limits](../../../docs/compatibility/bb-0.49.0/source-manifest.json).

[Manifest](manifest.json) pins each archive and member's SHA-256/size. Metadata
identifies BB 0.49.0 and SDK 0.6.132. Never use this payload on another release.
Automations remains pristine and has no deployment overrides.

Root owns any restoration, plugin reload and acceptance. Extract the matching
archive into the matching plugin's installed `dist` only after the current
[Questions zero-form gate](../../../docs/compatibility/bb-0.49.0/DEPLOYMENT-READY.md#questions-disposal-gate)
for Questions writes/reload. Verify all hashes and exact file sets before reload.
Restoring these archives changes installed artifacts; reverting the candidate Git
commit does not. No worker restoration or reload occurred.
