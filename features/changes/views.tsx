import type { Repository } from "./schemas.js";
import { repositoryPresentation } from "./model";

function RepositoryFiles({ repository, onOpenFile }: { repository: Repository; onOpenFile(path: string): void }) {
  return <div className="ws-current-pr-details ws-working-tree-files">{repository.changedFiles.map((file) => <button type="button" className="ws-working-tree-file" key={file.path} onClick={() => onOpenFile(file.path)} aria-label={`Open uncommitted diff for ${file.path}`}><b className={`ws-file-${file.status}`}>{file.status[0]?.toUpperCase()}</b><em>{file.path}</em><small>{file.insertions !== null ? `+${file.insertions}` : ""} {file.deletions !== null ? `−${file.deletions}` : ""}</small></button>)}{repository.changedFileCount > repository.changedFiles.length && <small>Only the first {repository.changedFiles.length} files are shown.</small>}</div>;
}

function RepositoryDetails({ repository, expanded, onToggle, onOpenFile }: { repository: Repository; expanded: boolean; onToggle(): void; onOpenFile(path: string): void }) {
  const countLabel = `${expanded ? "Hide" : "Show"} ${repository.changedFileCount} working-tree file${repository.changedFileCount === 1 ? "" : "s"}`;
  return <><div className="ws-card-meta"><span>{repository.ahead}↑ {repository.behind}↓</span><span>{repository.base ?? "—"}</span>{repository.changedFileCount > 0 && <button type="button" className="ws-repository-changes-toggle" aria-expanded={expanded} onClick={onToggle} aria-label={countLabel}><b>{repository.changedFileCount}</b> file{repository.changedFileCount === 1 ? "" : "s"} <i>+{repository.changedInsertions}</i> <em>−{repository.changedDeletions}</em> {expanded ? "⌄" : "›"}</button>}</div>{expanded && repository.changedFileCount > 0 && <RepositoryFiles repository={repository} onOpenFile={onOpenFile} />}</>;
}

export function ChangesRepositoryCard({ repository, loading, expanded, onToggle, onOpenFile }: { repository: Repository | undefined; loading: boolean; expanded: boolean; onToggle(): void; onOpenFile(path: string): void }) {
  if (loading) return <article className="ws-card ws-empty-state-card" aria-busy="true"><div className="ws-card-heading"><strong>Repository</strong></div><p className="ws-card-note">Loading pull requests and working-tree changes…</p></article>;
  const presentation = repository ? repositoryPresentation(repository) : { label: "Unavailable", tone: "unavailable" as const };
  return <article className="ws-card ws-repository-card"><div className="ws-card-heading"><strong>{repository?.branch ?? "Repository"}</strong><span className={`ws-pill ${presentation.tone === "changed" ? "ws-pr-changes_requested" : ""}`}>{presentation.label}</span></div>{repository?.outcome === "available" ? <RepositoryDetails repository={repository} expanded={expanded} onToggle={onToggle} onOpenFile={onOpenFile} /> : <p className="ws-card-note">{repository?.message ?? "Repository status is unavailable."}</p>}</article>;
}
