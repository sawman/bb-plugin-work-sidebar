import type { ReactElement } from "react";

export type ChangedFileListItem = {
  path: string;
  status: string;
  additions: number | null;
  deletions: number | null;
};

function ChangedFileRow({
  file,
  onOpenFile,
}: {
  file: ChangedFileListItem;
  onOpenFile?: (path: string) => void;
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
      <small
        className="ws-file-additions"
        aria-label={
          file.additions === null
            ? undefined
            : `${file.additions} ${file.additions === 1 ? "line" : "lines"} added`
        }
        aria-hidden={file.additions === null ? true : undefined}
      >
        {file.additions === null ? "" : `+${file.additions}`}
      </small>
      <small
        className="ws-file-deletions"
        aria-label={
          file.deletions === null
            ? undefined
            : `${file.deletions} ${file.deletions === 1 ? "line" : "lines"} deleted`
        }
        aria-hidden={file.deletions === null ? true : undefined}
      >
        {file.deletions === null ? "" : `−${file.deletions}`}
      </small>
    </>
  );
  return onOpenFile ? (
    <button
      type="button"
      className="ws-change-file-row"
      onClick={() => onOpenFile(file.path)}
      aria-label={`Open uncommitted diff for ${file.path}`}
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
  unavailableMessage = "Changed files are unavailable.",
  emptyMessage = "No changed files.",
  truncated = false,
}: {
  files: readonly ChangedFileListItem[] | null;
  onOpenFile?: (path: string) => void;
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
