import { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { WorkCard, WorkCardHeading } from "./card";

export type LinearCardContext = {
  tracker: {
    visible: boolean; available: boolean; message: string | null;
    suggestions: Array<{ key: string; title: string; url: string }>;
    item: { key: string; title: string; url: string } | null;
    statusOptions: Array<{ id: string; name: string; current: boolean }>;
  };
};

export function LinearCard({ context, linking, onLink, onUnlink, onMove, onSearch }: { context: LinearCardContext; linking: boolean; onLink(key: string): void; onUnlink(): void; onMove(statusId: string): void; onSearch(query: string): Promise<Array<{ key: string; title: string; url: string }>> }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ key: string; title: string; url: string }>>([]);
  const [searching, setSearching] = useState(false);
  const tracker = context.tracker;
  useEffect(() => { setSuggestions(tracker.suggestions); }, [tracker.suggestions]);
  useEffect(() => {
    if (tracker.item || !query.trim()) return;
    const timeout = window.setTimeout(() => { setSearching(true); void onSearch(query).then(setSuggestions).catch(() => setSuggestions([])).finally(() => setSearching(false)); }, 180);
    return () => window.clearTimeout(timeout);
  }, [onSearch, query, tracker.item]);
  if (!tracker.visible) return null;
  if (tracker.item) return <WorkCard className="ws-linear-card"><WorkCardHeading title="Linear" trailing={<div className="ws-linear-controls"><select aria-label="Linear issue status" value={tracker.statusOptions.find((option) => option.current)?.id ?? ""} onChange={(event) => onMove(event.target.value)} disabled={linking}>{tracker.statusOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button type="button" className="ws-text-button" onClick={onUnlink} disabled={linking}>Unlink</button></div>} /><a className="ws-linear-issue" href={tracker.item.url} target="_blank" rel="noreferrer"><b>{tracker.item.key}</b><span>{tracker.item.title}</span></a></WorkCard>;
  return <WorkCard className="ws-linear-card"><WorkCardHeading title="Linear" />{tracker.available && <div className="ws-linear-options" role="listbox" aria-label="Suggested Linear issues"><div className="ws-linear-search-row"><Input id="ws-linear-key" aria-label="Search Linear issues" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues by key or title" disabled={linking} /></div>{suggestions.map((item) => <button key={item.key} type="button" role="option" onClick={() => { setQuery(""); onLink(item.key); }} disabled={linking}><b>{item.key}</b><span>{item.title}</span></button>)}{searching && <small>Searching…</small>}{!searching && suggestions.length === 0 && <small>{query ? "No matching issues." : "No related issues found."}</small>}</div>}{!tracker.available && <small className="ws-linear-error">{tracker.message ?? "Taskboard’s Linear connection is unavailable for this project."}</small>}</WorkCard>;
}
