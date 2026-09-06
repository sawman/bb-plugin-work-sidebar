# BBPLUG-385 — stable Inbox search height

Base: `6416d980b1b547f584c261561e16bc80b2baf119`

## Result

- The Inbox header previously swapped a 1rem search icon for an adjacent
  shared search input whose default height was 1.55rem, increasing the card
  height whenever search opened.
- The heading actions now own one 1rem control-size token inherited by both
  the icon trigger and the open search input. Opening search therefore changes
  width only; the header and card height remain stable.
- Added an architecture regression requiring both controls to use that shared
  size.

## Evidence

- RED: the new shared-height assertions failed before the CSS change.
- Focused: 3 files / 35 tests passed twice.
- Full serial: 108 files / 756 tests passed.
- Typecheck, SDK 0.4.47 compatibility, build, and diff checks passed.
- Plugin source resolves to the canonical checkout.
- Light/dark theme-control matrix passed and restored the original preference.
- Plugin reload passed; post-reload logs contain no new Inbox errors.
