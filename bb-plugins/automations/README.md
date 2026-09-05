# Automations: personal-project availability

## Problem

The built-in Automations plugin rejected the personal project because
`projects.get({ projectId })` did not return it, despite the SDK listing the
same non-deleted project when called with `includePersonal: true`.

## Patch

When the direct lookup fails, the plugin checks the personal-inclusive project
list for the same active ID. It preserves the original direct-lookup error for
missing, deleted, or unreadable projects. The source patch is
[personal-projects.patch](personal-projects.patch).

## Current deployment

- Target: `builtin:automations` inside BB `0.42.0`, SDK `0.4.47`.
- Verified source baseline: `desktop-v0.42.0` at
  `960255b98ce3dccdcb5754eb67a7f989236602a1`.
- Validation: 81 focused tests, typecheck, and plugin build.
- Rebased and deployed through the cataloged 0.42.0 sync pass.

## Update procedure

Use the cataloged sync job from the repository root:

```sh
npm run bb-plugins:sync
# inspect the staged artifacts, then:
npm run bb-plugins:sync -- --deploy
```

It clones the exact `desktop-v<installed-version>` source tag, verifies every
patch against its immutable commit, runs focused tests/typecheck, builds each
built-in plugin, and stages artifacts before deployment. A new BB version with
no catalog entry fails closed; rebase the patch and update
[`registry.json`](../registry.json) first.
