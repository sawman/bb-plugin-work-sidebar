import { useMemo, useState } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread, PluginThreadListProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import "./app.css";

function title(thread: PluginSidebarThread): string {
  return thread.title?.trim() || thread.titleFallback || "Untitled thread";
}

function visibleThreads(threads: readonly PluginSidebarThread[], query: string): PluginSidebarThread[] {
  const needle = query.trim().toLocaleLowerCase();
  return !needle ? [...threads] : threads.filter((thread) => title(thread).toLocaleLowerCase().includes(needle));
}

function selectedRoots(ids: ReadonlySet<string>, threads: readonly PluginSidebarThread[]): string[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return [...ids].filter((id) => {
    let parentId = byId.get(id)?.parentThreadId ?? null;
    while (parentId) {
      if (ids.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentThreadId ?? null;
    }
    return true;
  });
}

function WorkThreadList(props: PluginThreadListProps) {
  const { status, threads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const visible = useMemo(() => visibleThreads(threads, props.searchQuery), [props.searchQuery, threads]);

  const Original = props.experimental_Original;
  if (status !== "ready") return Original ? <Original /> : null;

  const select = (thread: PluginSidebarThread, event: React.MouseEvent<HTMLButtonElement>) => {
    const toggle = event.ctrlKey || event.metaKey;
    const range = event.shiftKey && anchorId;
    if (range) {
      const first = visible.findIndex((candidate) => candidate.id === anchorId);
      const last = visible.findIndex((candidate) => candidate.id === thread.id);
      if (first >= 0 && last >= 0) setSelected(new Set(visible.slice(Math.min(first, last), Math.max(first, last) + 1).map((candidate) => candidate.id)));
      else setSelected(new Set([thread.id]));
    } else if (toggle) {
      setSelected((current) => {
        const next = new Set(current);
        next.has(thread.id) ? next.delete(thread.id) : next.add(thread.id);
        return next;
      });
      setAnchorId(thread.id);
    } else {
      setSelected(new Set([thread.id]));
      setAnchorId(thread.id);
      actions.open(thread.id);
      props.onNavigate();
    }
  };

  const archiveSelected = () => {
    for (const id of selectedRoots(selected, threads)) actions.archive(id);
    setSelected(new Set());
  };

  return <section className="ws-list" aria-label="Work threads">
    <header className="ws-toolbar">
      <strong>{selected.size ? `${selected.size} selected` : `${visible.length} threads`}</strong>
      {selected.size > 0 && <button type="button" onClick={archiveSelected}>Archive selected</button>}
    </header>
    <p className="ws-hint">Shift-click selects a range. Control/Command-click toggles individual threads.</p>
    {visible.map((thread) => <div className={`ws-row ${selected.has(thread.id) ? "ws-selected" : ""}`} key={thread.id}>
      <button type="button" className="ws-thread" aria-pressed={selected.has(thread.id)} onClick={(event) => select(thread, event)}>
        <span className="ws-title">{title(thread)}</span>
        <small>{thread.environment?.branchName || thread.providerId}</small>
      </button>
      <button type="button" className="ws-delete" aria-label={`Delete ${title(thread)}`} onClick={() => actions.requestDelete(thread.id)}>Delete</button>
    </div>)}
    {visible.length === 0 && <p className="ws-empty">No matching threads.</p>}
  </section>;
}

function WorkPanel({ threadId }: PluginThreadPanelProps) {
  const { status, threads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const thread = threads.find((candidate) => candidate.id === threadId);
  const children = threads.filter((candidate) => candidate.parentThreadId === threadId);
  if (status !== "ready" || !thread) return <section className="ws-panel">Loading current work…</section>;
  return <section className="ws-panel">
    <h2>Current Work</h2>
    <h3>{title(thread)}</h3>
    <p>{children.length} direct child thread{children.length === 1 ? "" : "s"}</p>
    <div className="ws-actions">
      <button type="button" onClick={() => actions.archive(thread.id)}>Archive thread and children</button>
      <button type="button" className="ws-danger" onClick={() => actions.requestDelete(thread.id)}>Delete thread and children</button>
    </div>
  </section>;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({ id: "work-queue", title: "Work Queue", description: "Selected work threads.", component: WorkThreadList });
  app.slots.threadPanelAction({ id: "work-context", title: "Current Work", icon: "ListTodo", component: WorkPanel, layout: "flush" });
});
