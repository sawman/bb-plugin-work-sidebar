# ADR 0003: Build the UI from atomic, theme-aware primitives

Status: Accepted
Date: 2026-08-27

## Context

The plugin has competing `.ws-card`, `.ws-work-card`, and `.ws-surface`
contracts. Feature selectors override descendant typography and control sizes,
while resets and `!important` make the result dependent on import order and
markup shape. Similar statuses also use different icons or colors across the
two sidebars.

## Decision

Build a small atomic layer from BB-vendored shadcn components and host theme
tokens. Likely resulting primitives include surfaces, list rows, tabs,
disclosures, buttons, status icons, badges, tooltips, selects/comboboxes, and
standard loading/empty/error states, but this list is not pre-approved.

Primitives own typography, spacing, focus treatment, and variants. Features
compose primitives and own only feature-specific layout.

Centralize domain presentations for PR/check/review, task, runtime, repository,
and health states. Both sidebars consume the same presentation functions.

Use BB's host Diff and SourceCode renderers rather than maintaining a separate
diff component and theme.

Vendored shadcn source uses host theme tokens. R3 must prove in the live host
whether `bb plugin build` emits utility classes not already present in host CSS.
If that probe fails, primitives use plain plugin CSS over host tokens and
shadcn is vendored for structure and behavior only; that material narrowing is
recorded in a superseding ADR before feature primitives migrate. React, the SDK
app runtime, Sonner, the portal Radix families,
`@pierre/diffs`, `clsx`, `tailwind-merge`, and
`class-variance-authority` use BB's runtime shims and therefore stay in
version-aligned `devDependencies`; they are never bundled as second singleton
copies. Non-shimmed packages remain ordinary plugin dependencies.

Primitives own internal padding, line-height, typography, focus, and the
spacing between their own children. Features own margins, grid/flex placement,
and gaps between primitives. Do not create a speculative Stage 1 component
catalog: build a primitive with its first slice and promote it to `shared/ui`
when the second semantic consumer adopts it. Query/provider infrastructure and
host-component adapters are infrastructure, not exemptions to this rule.

Experimental host components and hooks are wrapped behind narrow plugin
adapters. R1 pins the SDK to the running host's exact version and
`bb plugin types --check` is a release gate. This confines SDK churn without
forking BB's renderer behavior.

## Consequences

- Adding a card cannot silently introduce another type scale.
- Status meaning remains consistent across surfaces.
- Host palette and light/dark changes apply automatically.
- Some complex layout CSS remains necessary for stack rails, drag insertion,
  and sticky sidebar chrome.
- Existing selectors must be removed as each feature migrates; retaining them
  would keep the cascade unstable.
- Vendored source adds type-only shim dependencies but no duplicate host
  singleton runtimes.

## Guardrails

- Prefer semantic `data-*` variants over feature-specific modifier classes.
- Do not hardcode gray palettes or duplicate semantic colors.
- Do not use `all: unset` or undocumented `!important`.
- Feature selectors do not change a primitive's descendant typography.
- Feature layout may set external margin/gap/grid placement, never a
  primitive's internal type or control scale.
- Icon-only controls have accessible names and visible focus.
- Selection, hover, and dropdown highlights use the same semantic treatment.
- Host Diff/SourceCode access goes through the plugin adapter; feature slices
  do not import `react-diff-view` or `@pierre/diffs` directly.
