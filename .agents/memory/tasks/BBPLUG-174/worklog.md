# BBPLUG-174

- Scope: one bounded server-backed text-scale preference for both sidebars.
- Required contract: strict browser-safe Zod schemas, typed RPC, TanStack Query, existing appearance editor/debounce/toast behavior, one root CSS token seam.
- Verification requested: focused tests twice, full serial tests twice, typecheck, SDK compatibility, build/CSS gate, diff check; no reload or push.
- Base commit: `097b01de9a9329f0849aee2828160dfb78760b10`.
- Initial worktree: clean.
- RED contract chosen: text scale 0.90–1.10, 0.01 step, 8px minimum for the 0.58rem role at a 16px root.
- RED coverage added for strict schema, legacy-compatible server storage, Query round-trip, invalid input, debounce failure/recovery, and narrow editor layout.
- GREEN coverage now includes exact registered RPC calls, both root CSS variables, live Query-driven update, and axe checks at compact scale.
- Review follow-up: `useSidebarAppearancePreferences` is now observer/mutation-only. The mounted left `useThreadPreferences` subscription is the sole `sidebar-order:changed` appearance invalidation owner; two Work panels add no appearance realtime listeners.
- Follow-up registration coverage mounts one left list and two Work panels, proves panel events produce no appearance invalidation, one left event produces exactly one appearance invalidation/refetch, both panel roots update, and a settings save updates all roots through the shared cache.
- Final follow-up validation: focused 6-file/26-test suite twice; full serial 78-file/443-test suite twice; typecheck; SDK check; build; and `git diff --check` all passed. No reload or push.
