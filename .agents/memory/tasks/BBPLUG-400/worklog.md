# BBPLUG-400 — normalize Changes subtitle icons

## Outcome

- Removed the ineffective feature-owned SVG size rule that was overridden by
  the later shared status rule.
- Made the shared metadata `Status` variant own a 0.58rem icon box and unit
  line height.
- Replaced the negative subtitle baseline adjustment with standard middle
  alignment.
- Standardized checks-to-review, review-to-unresolved, and
  unresolved-to-resolved spacing at 0.14rem; icon-to-count remains the tight
  0.04rem relationship.
- Lifted the bottom-heavy shared wrench glyph by one additional view-box unit.
- Preserved the leading PR-state icon's intended 0.67rem size through a
  primitive-owned selector.

## Evidence

- RED: geometry policy and wrench tests failed against the prior cascade.
- Focused icon, stylesheet, and Changes view tests: 34 passed.
- Full serial suite: 108 files / 770 tests passed.
- Typecheck, SDK 0.4.87 compatibility, production build, and diff check passed.
- Non-foreground light/dark theme matrix completed and restored the original
  preference.
- The supplied screenshot was inspected at original resolution. A live crop
  after reload was attempted without taking foreground control, but the active
  thread had its right panel collapsed, so no unsupported visual claim is made.
