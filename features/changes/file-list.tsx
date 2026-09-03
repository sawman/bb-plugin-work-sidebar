import type { ReactElement } from "react";
import { ChangeLineDelta } from "./line-deltas.js";

export type ChangedFileListItem = {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
};

function ChangedFileRow({
  file,
  onOpenFile,
  openFileLabel,
}: {
  file: ChangedFileListItem;
  onOpenFile?: (path: string) => void;
  openFileLabel?: (path: string) => string;
}): ReactElement {
  const status = ["added", "deleted", "modified", "renamed", "untracked"].includes(
    file.status,
  )
    ? file.status
    : "modified";
  const content = (
    <>
      <b className={`ws-file-${status}`}>
        {status[0]?.toUpperCase()}
      </b>
      <em>{file.path}</em>
      <ChangeLineDelta
        kind="additions"
        value={file.additions}
        className="ws-file-additions"
      />
      <ChangeLineDelta
        kind="deletions"
        value={file.deletions}
        className="ws-file-deletions"
      />
    </>
  );
  return onOpenFile ? (
    <button
      type="button"
      className="ws-change-file-row"
      onClick={() => onOpenFile(file.path)}
      aria-label={openFileLabel?.(file.path) ?? `Open uncommitted diff for ${file.path}`}
    >
      {content}
    </button>
  ) : (
    <span className="ws-change-file-row">{content}</span>
  );
}

export function ChangedFilesList({
  files,
  onOpenFile,
  openFileLabel,
  unavailableMessage = "Changed files are unavailable.",
  emptyMessage = "No changed files.",
  truncated = false,
}: {
  files: readonly ChangedFileListItem[] | null;
  onOpenFile?: (path: string) => void;
  openFileLabel?: (path: string) => string;
  unavailableMessage?: string;
  emptyMessage?: string;
  truncated?: boolean;
}): ReactElement {
  return (
    <div className="ws-stack-files ws-changes-file-list-scroll">
      {files === null ? (
        <small>{unavailableMessage}</small>
      ) : files.length === 0 ? (
        <small>{emptyMessage}</small>
      ) : (
        files.map((file) => (
          <ChangedFileRow
            key={file.path}
            file={file}
            onOpenFile={onOpenFile}
            openFileLabel={openFileLabel}
          />
        ))
      )}
      {files !== null && truncated && (
        <small className="ws-stack-files-truncated">
          Only the first {files.length} files are shown.
        </small>
      )}
    </div>
  );
}
