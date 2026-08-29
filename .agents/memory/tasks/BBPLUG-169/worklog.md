# BBPLUG-169 — R36 drag reparenting

- Base commit: `097b01de9a9329f0849aee2828160dfb78760b10`
- Pre-loop tree: clean (`git status --short` had no output).
- Scope: extend the existing single pointer controller with explicit reparent
  and To Top drop targets; preserve sibling/group/archive reorder and native
  split handoff; route hierarchy writes through the existing guarded mutation.
- RED evidence: the new accessible target test initially could not run until
  dependencies were restored; the later pointer-cancel RED reproduced an
  unwanted reorder on cancel. The controller now has a non-committing cancel
  path.
- GREEN evidence: focused pointer/registered-slot/query/architecture suite
  passed twice (37 tests); full serial suite passed twice (78 files, 440
  tests). Final gates: typecheck, SDK compatibility, build, and diff check.
