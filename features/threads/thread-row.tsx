import { useState, type MouseEvent, type PointerEvent } from "react";

type Thread = { id: string; title: string | null; titleFallback: string | null };
type Actions = { open(id: string, options: { split: boolean }): void; rename(id: string, title: string): void | Promise<void>; archive(id: string): void; requestDelete(id: string): void };

/** Host actions are injected from the BB hook; this view never recurses through children itself. */
export function ThreadRow({ thread, actions, splitProps, splitAvailable, onSelect, onNavigate }: { thread: Thread; actions: Actions; splitProps: { onPointerDown?(event: PointerEvent<HTMLAnchorElement>): void }; splitAvailable: boolean; onSelect(thread: Thread, event: MouseEvent<HTMLAnchorElement>): boolean; onNavigate(): void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title ?? thread.titleFallback ?? "Untitled thread");
  const open = (split = false) => { actions.open(thread.id, { split }); onNavigate(); };
  if (renaming) return <input aria-label="Thread title" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { void actions.rename(thread.id, title.trim()); setRenaming(false); } if (event.key === "Escape") setRenaming(false); }} />;
  return <div><a href="#" aria-label={title} data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id} {...splitProps} onClick={(event) => { event.preventDefault(); if (!onSelect(thread, event)) open(); }} onContextMenu={(event) => { event.preventDefault(); setMenuOpen(true); }}>{title}</a>{menuOpen && <menu><button role="menuitem" onClick={() => open()}>Open</button>{splitAvailable && <button role="menuitem" onClick={() => open(true)}>Open in split</button>}<button role="menuitem" onClick={() => setRenaming(true)}>Rename</button><button role="menuitem" onClick={() => actions.archive(thread.id)}>Archive</button><button role="menuitem" onClick={() => actions.requestDelete(thread.id)}>Delete</button></menu>}</div>;
}
