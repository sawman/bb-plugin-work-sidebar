# Work Sidebar

Work Sidebar is a BB plugin that adds an operational sidebar for threads,
pull requests, tasks, work items, changes, agents, and provider health. It
also adds a Work panel for the selected thread.

## Install

Install directly from GitHub:

```sh
bb plugin install https://github.com/sawman/bb-plugin-work-sidebar
```

Then reload it after updating configuration or source:

```sh
bb plugin reload work-sidebar
```

The plugin requires BB `>=0.38` with plugin SDK `>=0.4.21`.

## BB integration dependencies

Work Sidebar is installed as one plugin. Its npm packages are bundled during
the plugin build; users do not install those separately. Its BB integrations
fall into three categories:

| Integration | Needed for | Behavior when unavailable |
| --- | --- | --- |
| **BB Tasks** (built in) | BB task queue, Work-item goals, task ownership, durable execution bindings, and agent task tools | The plugin still loads, but its task and work-item workflows are unavailable. Treat Tasks as required for the full experience. |
| **Taskboard** (`taskboard`, optional) | Linear issue search, linking, primary Linear goals, and Linear status updates | Everything else keeps working. The Work card stays BB-Tasks-only, without an install prompt or Linear controls. Existing Linear links are retained for when Taskboard returns. |
| **Provider retry** (built in, optional) | Enqueues provider retries alongside ordinary queued messages | The queue indicator still represents messages BB has queued; no provider-retry-specific reason appears. |
| Provider plugins (Codex, Claude, etc.) | Starting and running threads | No static dependency: Work Sidebar discovers host providers and renders whatever is available. |
| GitHub CLI authentication | Pull-request, Stack, review, and GitHub-health enrichment | Thread, Tasks, Work, and Agents surfaces continue to work; PR data reports its own unavailable/limited state. |

To enable Linear, install and configure Taskboard, then select Linear for the
BB project. A missing or disabled Taskboard is a supported degraded mode—not
an installation failure for Work Sidebar.

## What it adds

- Enhanced Threads, Tasks, and Pull Requests panes on the left.
- Work, Changes, and Agents tabs for the selected thread on the right.
- BB Tasks and Linear-backed work items, including a current Goal and a
  backlog of Goals.
- Thread organization, archived-thread recovery, provider status, PR review
  state, and GitHub health presentation.

## Agent workflow

This repository includes [`.bb/AGENTS.md`](.bb/AGENTS.md), which is the
authoritative guidance for agents changing the plugin. The short version:

1. Track implementation in BB Tasks, not a repository TODO list. Create one
   durable outcome and direct execution tasks for distinct work.
2. Delegate coding work through BB child threads, not a provider-native
   subagent tool. Use `bb thread spawn --parent-self --new-environment worktree`
   for an isolated code change.
3. For durable delegated task work, use the plugin's `bind_execution_owner`
   flow with a managed worktree. The built-in `bb tasks dispatch` command does
   not currently preserve the parent-thread relationship.
4. Archive completed child threads once their work is integrated; retain them
   only when their state is intentionally needed for continuing focused work.
5. Keep server data in TanStack Query, interaction state in Zustand, and
   ephemeral control state in React. Realtime events invalidate queries; they
   do not carry replacement domain state.

The compatibility items that depend on future BB SDK support are kept in
[`TODO.md`](TODO.md).

## Develop

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin types --check .
```

To register a local checkout while developing:

```sh
bb plugin install .
bb plugin reload work-sidebar
```

Before a reload, confirm the plugin points at the checkout you intend to run:

```sh
bb plugin source work-sidebar --json
```

For frontend changes, run the automated checks and also verify affected UI in
light and dark themes, at narrow widths, with keyboard and modifier-click
behavior. The repository's `npm run theme-control -- matrix -- <command>`
utility changes the desktop theme without navigating the BB Settings UI and
restores the original preference afterward.

## Contributing

Read [`.bb/AGENTS.md`](.bb/AGENTS.md) and the architecture records in
[`docs/adr`](docs/adr) before structural changes. Keep `app.tsx` and
`server.ts` as composition entry points, make changes by feature slice, and
remove replaced legacy code in the same change.
