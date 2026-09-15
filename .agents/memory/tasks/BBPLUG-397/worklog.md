# BBPLUG-397 — icon-only PR review counts

## Outcome

- Replaced the visible `open` and `resolved` words in the Changes review-count
  breakdown with existing shared `Circle` and `Check` icons.
- Retained the explicit unresolved/resolved wording in the status control's
  accessible label.
- Kept the icon sizing and colors inside the shared status primitive.

## Evidence

- RED: the updated mounted test failed while the old text labels remained.
- Focused Changes and PR presentation tests: 52 passed.
- Full serial suite: 108 files / 770 tests passed.
- Typecheck: passed.
- SDK compatibility: plugin and host SDK 0.4.87, passed.
- Production build: passed; only the existing Node DEP0205 warning.
- `git diff --check`: passed.
