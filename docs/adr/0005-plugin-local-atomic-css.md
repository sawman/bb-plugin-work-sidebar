# ADR 0005: Use plugin-local atomic CSS over host theme tokens

Status: Accepted
Date: 2026-08-28

## Context

The R3 styling path was resolved in the shipped implementation: the plugin's
atomic primitives are owned by the plugin and styled by its own stylesheet
over BB's theme tokens. The plugin does not ship vendored shadcn source or
rely on host utility-class compilation as a styling contract. Keeping ADR 0003
as accepted would direct later slices back toward the conditional path it
described.

## Decision

Use plugin-local atomic primitives with plain plugin CSS and BB host theme
tokens:

- The plugin owns the primitive source, behavior, typography, spacing, focus
  treatment, and semantic variants it ships.
- Primitive and feature styles derive color and other theme-sensitive values
  from BB's host tokens so light, dark, and custom palettes remain coherent.
- Feature selectors may own feature layout, such as stack rails, insertion
  lines, and sticky geometry, but do not restyle arbitrary primitive
  descendants.
- Prefer semantic `data-state`, `data-tone`, `data-selected`, and
  `data-expanded` variants. Do not add hardcoded gray/color palettes,
  `all: unset`, or undocumented `!important` declarations.
- Host-rendered Diff and SourceCode components remain the source of truth for
  those renderers; plugin-local CSS does not create a competing renderer.

Vendored shadcn source is not a prerequisite for this plugin's atomic layer.
If a future primitive adopts shadcn structure or behavior, its source and
styling still remain plugin-owned and must follow this CSS/token contract.

## Consequences

- The shipped stylesheet is an explicit plugin boundary and does not depend on
  which utility classes the host happens to compile.
- Primitive styling can be reviewed and tested with the plugin's source and
  build without introducing a second host-wide component system.
- New slices must remove superseded selectors in the same change and keep
  shared semantic primitives justified by more than one consumer.

## Verification

Architecture style checks parse plugin styles and reject forbidden or
unowned patterns. The production build must remain warning-free, and each
affected surface is checked in light/dark and narrow/wide states in the live
BB host. These checks validate the contract without treating a particular
future commit as permanent repository state.
