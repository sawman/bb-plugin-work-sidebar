# BB 0.46.0 pristine rollback artifacts

These archives capture the live desktop bundle's unmodified Questions,
Automations, and Tasks dist files before any 0.46 patch deployment. Each server
metadata file identifies BB 0.46.0 / SDK 0.6.37. Archive and individual artifact
SHA-256 values are in `manifest.json`.

Verify the manifest before extracting. Restore only to BB 0.46.0, then reload
the affected plugin. No settings, databases, schedules, or sessions are included.
This worker staged these rollback packages without deploying or reloading.
