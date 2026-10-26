# BB 0.47.1 pristine rollback

Captured from the installed 0.47.1 bundle before patch deployment. Each server/app metadata file identifies BB 0.47.1 and SDK 0.6.79. `manifest.json` records archive and member SHA-256, sizes and source paths. All six required artifacts exist for Questions, Tasks and Automations. Never use these archives with a different BB version.

To restore after root acceptance, extract the matching archive into the installed `server/dist/builtin-plugins/<plugin>/dist`, verify all member hashes, then reload that plugin. Automations remains pristine and is excluded from patch deployment.
