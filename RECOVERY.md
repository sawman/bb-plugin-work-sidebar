# Recovery notes

The original source directory was removed when BB completed retirement of
`env_wddcafieha`. It had no Git commits or configured remote.

BB's local event database still contains historical file reads and unified
diffs for this plugin. Reconstruction source:

```sh
sqlite3 -json ~/.bb/bb.db \
  "select e.thread_id, e.sequence, json_extract(e.data, '$.item.aggregatedOutput')
   from events e
   where e.type = 'item/completed'
     and json_extract(e.data, '$.item.aggregatedOutput') like '%function WorkThreadList%'
   order by e.created_at desc;"
```

The recovered plugin will include both sidebar surfaces:

- Left: the custom thread list (`threadLists`) with hierarchy, ordering, and
  thread actions.
- Right: the work-context thread panel (`threadPanels`) with current work,
  goals, pull-request stack, and delegated agents.

Do not remove the original `work-sidebar` plugin registration until the rebuilt
checkout has been validated and its source path is updated.
