# Architecture decision records

ADRs record cross-cutting decisions that future agents should preserve or
explicitly supersede.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-vertical-slice-architecture.md) | Accepted | Organize product code and migration as vertical feature slices |
| [0002](0002-state-ownership.md) | Accepted | Divide BB host, server, shared UI, and local state by semantics |
| [0003](0003-atomic-ui-and-styling.md) | Accepted | Use atomic primitives and host theme contracts |
| [0004](0004-incremental-migration-and-verification.md) | Accepted | Migrate and verify one complete slice at a time |

New records use the next zero-padded number. Clarifications that leave a
decision intact may amend its consequences or guardrails in place. To reverse
or materially narrow an accepted decision, preserve its body, change only its
status to `Superseded by NNNN`, and add the new ADR explaining what it
supersedes and why.
