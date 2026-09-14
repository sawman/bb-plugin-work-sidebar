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

- Target: `builtin:automations` inside BB `0.43.1`, SDK `0.4.87`.
- Verified source baseline: `desktop-v0.43.1` at
  `267938526dfcbc0edb228ce827b5bec202c1af97`.
- Validation: 81 focused tests, typecheck, and plugin build.
- Rebased and deployed through the cataloged 0.43.1 sync pass.

## BB 0.43.1 upgrade

- The personal-inclusive overview read remains upstream, but creation still
  relies solely on `projects.get` and rejects the personal project.
- The patch was rebased over the new error-normalization code. The preflight
  and deployment pass each passed 81 tests, typecheck, and build; installed
  artifacts match the staged SHA-256 hashes.

## BB 0.42.1 upgrade

- Verified source baseline: `desktop-v0.42.1` at
  `a4aa07f9ee3fdeb5716a26a368246ea1ef9e0b78`.
- BB 0.42.1 does not change the Automations plugin or SDK 0.4.47. The patch
  still applies unchanged.
- The full 0.42.1 preflight and deployment pass each passed 81 plugin tests,
  typecheck, and build. The resulting BB 0.42.1 / SDK 0.4.47 artifacts were
  deployed with a version-matched local backup and exact checksum parity.

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
